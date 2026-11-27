// Helpers shared by views and widgets.

/** Creates an element: h("li", { class: "done", onclick }, "text", child, ...) */
export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);

  // edit the element
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue; // invalid value (false or null)
    
    // set class
    if (key === "class") element.className = value;
    // set styles
    else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) 
        element.style.setProperty(prop, v);
    }
    // callbacks
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value);
    // set key index
    else if (key in element && typeof value !== "string") element[key] = value;
    // otherwise set attribute 
    else element.setAttribute(key, value === true ? "" : value);
  }

  // append all the children
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

/** Pronote descriptions are HTML: keep only the text, with line breaks. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(
    String(html ?? "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n"),
    "text/html",
  );
  return (doc.body.textContent ?? "").replace(/\n{2,}/g, "\n").trim();
}

// ---- Dates ----
export const DAY = 864e5;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

export const formatDay = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
export const formatShortDay = (d) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
export const formatTime = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** "aujourd'hui", "demain", "lundi 23 nov." */
export function relativeDay(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return "demain";
  if (diff === -1) return "hier";
  return formatShortDay(d);
}

/** "dans 25 min", "dans 2 h 10" */
export function inDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  return `${hours} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
}

export function formatAgo(timestamp) {
  if (!timestamp) return "jamais";
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const d = new Date(timestamp);
  return sameDay(d, new Date()) ? `à ${formatTime(d)}` : `le ${d.toLocaleDateString("fr-FR")} à ${formatTime(d)}`;
}

// ---- Data helpers ----

/** Snapshot dates come as ISO strings. */
export const homeworkList = (data) =>
  (data.homework ?? []).map((a) => ({ ...a, deadline: new Date(a.deadline) })).sort((a, b) => a.deadline - b.deadline);

export const classList = (data) =>
  (data.timetable ?? [])
    .map((c) => ({ ...c, startDate: new Date(c.startDate), endDate: new Date(c.endDate) }))
    .sort((a, b) => a.startDate - b.startDate);

export const classTitle = (c) => (c.is === "lesson" ? c.subject?.name ?? "Cours" : c.title ?? "Activité");

// A test word near the start ("Contrôle bilan...", "Irregular verbs test:").
// Further in, it's usually revision for a test ("... pour le DS de jeudi").
const TEST_WORDS = /(^|[^\p{L}])(contr[ôo]le|ds|devoir surveill[ée]|[ée]valuation|interro(gation)?|test|bac blanc|examen|partiel)([^\p{L}]|$)/iu;
export const looksLikeTest = (a) => TEST_WORDS.test(htmlToText(a.description).slice(0, 45));

/** "ENSEIGN.SCIENTIFIQUE > ENSEIGN.SCIENTIFIQUE" -> "ENSEIGN.SCIENTIFIQUE" */
export function subjectName(name) {
  const parts = String(name ?? "?").split(" > ");
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : parts.join(" › ");
}

/**
 * Subject color from Pronote. Some subjects come white (invisible on a white
 * card): those fall back to a neutral gray.
 */
/** A stable pattern number (0-7) for a name: lets colour-blind mode tell subjects/people apart. */
export function patternIndex(name) {
  let h = 0;
  for (const ch of String(name ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 8;
}

export function subjectColor(c) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(c?.backgroundColor ?? "")?.[1];
  if (!hex) return c?.backgroundColor || "var(--muted)";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.88 ? "var(--muted)" : `#${hex}`;
}

// ---- Grades ----

// GradeValue.kind 0 = a real number; the other kinds are statuses.
const GRADE_STATUS = { 1: "Abs.", 2: "Disp.", 3: "N.Not.", 4: "Inapte", 5: "N.Rendu", 6: "Abs. 0", 7: "N.Rendu 0", 8: "Félic." };
export const isNumber = (v) => v && v.kind === 0 && Number.isFinite(v.points);
export const gradeText = (v) => (!v ? "–" : isNumber(v) ? fmtNum(v.points) : GRADE_STATUS[v.kind] ?? "?");
export const fmtNum = (n, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString("fr-FR", { maximumFractionDigits: digits }) : "–";

/** Grade as a fraction of its scale (0..1), or null when it doesn't count (absent, exempted...). Zeros for "Abs. 0"/"N.Rendu 0". */
export function on0to1(g) {
  if (g.value?.kind === 6 || g.value?.kind === 7) return 0;
  if (!isNumber(g.value) || !isNumber(g.outOf) || g.outOf.points <= 0) return null;
  return g.value.points / g.outOf.points;
}

/** Grade on 20, or null when it doesn't count. */
export function on20(g) {
  const n = on0to1(g);
  return n === null ? null : n * 20;
}

/** Class average as a fraction of the grade's scale (0..1), or null. */
export function averageGrade0To1(g) {
  return isNumber(g.average) && isNumber(g.outOf) && g.outOf.points > 0 ? g.average.points / g.outOf.points : null;
}

/** Gap with the class average on the grade's own scale (+2 for 8/10 vs 6/10), or null. */
export function diffWithAverage(g) {
  const mine = on0to1(g);
  const avg = averageGrade0To1(g);
  if (mine === null || avg === null) return null;
  return (mine - avg) * g.outOf.points;
}

/**
 * Estimated subject average with Pronote's rules:
 * - each grade has a coefficient;
 * - a grade converted to /20 (isOutOf20) weighs like a /20 mark; otherwise it
 *   weighs with its own scale (a 7/10 counts half as much as a mark out of 20);
 * - bonus grades: only points above 10 (on 20) count, added on top;
 * - optional grades: only count if they raise the average.
 * Returns the average on 20, or null without countable grades.
 */
export function estimateAverage(grades) {
  let num = 0;
  let den = 0;
  let bonus = 0;
  const optional = [];

  for (const g of grades) {
    const n = on20(g);
    if (n === null) continue;
    const coef = Number.isFinite(g.coefficient) ? g.coefficient : 1;
    if (coef <= 0) continue;
    const scale = g.isOutOf20 || !isNumber(g.outOf) ? 1 : g.outOf.points / 20;
    const w = coef * scale;
    if (g.isBonus) bonus += Math.max(0, n - 10) * w;
    else if (g.isOptional) optional.push({ n, w });
    else {
      num += n * w;
      den += w;
    }
  }
  // Add optional grades best first, while they raise the average.
  optional.sort((a, b) => b.n - a.n);
  for (const o of optional) {
    if (den === 0 || o.n > num / den) {
      num += o.n * o.w;
      den += o.w;
    }
  }
  if (den === 0) return null;
  return Math.min(20, (num + bonus) / den);
}

/**
 * Overall average from subject averages, with per-subject settings
 * { [subjectName]: { coef = 1, mode = "normal" | "bonus" | "excluded" } }.
 * Bonus subjects (optional courses): only points above 10 count, times their
 * coefficient, added on top of the normal subjects.
 */
export function overallAverage(subjects, settings = {}) {
  let num = 0;
  let den = 0;
  let bonus = 0;
  for (const s of subjects) {
    if (s.average === null || s.average === undefined) continue;
    const { coef = 1, mode = "normal" } = settings[s.name] ?? {};
    if (mode === "excluded" || !(coef > 0)) continue;
    if (mode === "bonus") bonus += Math.max(0, s.average - 10) * coef;
    else {
      num += s.average * coef;
      den += coef;
    }
  }
  return den > 0 ? Math.min(20, (num + bonus) / den) : null;
}

// ---- Small UI pieces ----

export function emptyState(text) {
  return h("p", { class: "empty" }, text);
}

export function card(title, body, extra) {
  return h("section", { class: "card" }, title ? h("h2", {}, title, extra ?? null) : null, body);
}

/** creates a div element */
export function div(attrs = {}, ...children) {
  return h("div", attrs, ...children);
}

/** creates an li element */
export function li(attrs = {}, ...children) {
  return h("li", attrs, ...children);
}

/** creates a span element */
export function span(attrs = {}, ...children) {
  return h("span", attrs, ...children);
}

// ---- Rich text from Pronote (news, lesson contents) ----
const SAFE_TAGS = new Set(["P", "BR", "DIV", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "A", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "HR"]);

/**
 * Pronote HTML -> safe DOM: only basic formatting and http(s) links are kept.
 * Every other tag is replaced by its content; no attribute survives except href.
 */
export function safeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const clean = (node) => {
    const out = document.createDocumentFragment();
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out.append(child.textContent);
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(child.tagName)) continue;
        if (!SAFE_TAGS.has(child.tagName)) {
          out.append(clean(child));
          if (["TR", "TABLE"].includes(child.tagName)) out.append(document.createElement("br"));
          continue;
        }
        const element = document.createElement(child.tagName);
        if (child.tagName === "A") {
          const href = child.getAttribute("href") ?? "";
          if (/^https?:\/\//i.test(href)) {
            element.href = href;
            element.target = "_blank";
            element.rel = "noreferrer noopener";
          }
        }
        element.append(clean(child));
        out.append(element);
      }
    }
    return out;
  };
  const wrap = document.createElement("div");
  wrap.className = "rich";
  wrap.append(clean(doc.body));
  return wrap;
}

/** Stable identity of a homework (Pronote ids change every session). Same as the server's. */
export function homeworkKey(a) {
  const d = new Date(a.deadline);

  // better style...
  const text = String(a.description ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${a.subject?.name ?? "?"}|${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}|${text}`;
}
