// "Simulateurs": exam calculators (bac général / techno / pro, brevet, weighted average).
// Rules and coefficients come from ../exam-rules.js; marks can be prefilled from
// Pronote averages and every field stays editable. Entries are kept per
// calculator in localStorage (this browser only).
import { h, subjectName, isNumber, fmtNum, estimateAverage } from "../lib.js";
import { store } from "../state.js";
import { R, normalize } from "../coef-presets.js";
import { CALCULATORS, GROUPS, RULES_CHECKED } from "../exam-rules.js";

const KEY = "repronote.simulateurs.v1";
let saved = load();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // private window / storage blocked: entries just won't survive a reload
  }
}
const ui = () => (saved.ui ??= {});
const calcState = (id) => ((saved.calcs ??= {})[id] ??= {});

// ---- Numbers ----
/** "12,5" -> 12.5; "" -> null; garbage -> NaN */
function parseNum(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const validMark = (n) => n === null || (n >= 0 && n <= 20);
const validCoef = (n) => n === null || n >= 0;
const markOrNull = (s) => {
  const n = parseNum(s);
  return n !== null && validMark(n) ? n : null;
};
const toInput = (n) => (n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ","));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- Pronote averages ----

/** Subject -> average for one period (Pronote's average, else estimated from the grades). */
function periodAverages(grades, periodId) {
  const ov = grades?.byPeriod?.[periodId];
  const map = new Map();
  if (!ov) return map;
  for (const sa of ov.subjectsAverages ?? []) {
    map.set(subjectName(sa.subject?.name), isNumber(sa.student) ? sa.student.points : null);
  }
  const bySubject = new Map();
  for (const g of ov.grades ?? []) {
    const n = subjectName(g.subject?.name);
    if (!bySubject.has(n)) bySubject.set(n, []);
    bySubject.get(n).push(g);
  }
  for (const [n, list] of bySubject) if (map.get(n) == null) map.set(n, estimateAverage(list));
  return map;
}

const hasValues = (map) => [...map.values()].some((v) => v != null);

/** [{ name, norm, avg }] for a period id, or "year" (Pronote's year period, else the mean of the periods). */
function pronoteSubjects(grades, source) {
  if (!grades?.periods?.length) return [];
  const list = (map) => [...map].map(([name, avg]) => ({ name, norm: normalize(name), avg }));
  if (source !== "year") return list(periodAverages(grades, source));

  const yearPeriod = grades.periods.find((p) => /ANNEE/.test(normalize(p.name ?? "")) && hasValues(periodAverages(grades, p.id)));
  if (yearPeriod) return list(periodAverages(grades, yearPeriod.id));

  const all = new Map();
  for (const p of grades.periods) {
    for (const [name, avg] of periodAverages(grades, p.id)) {
      if (!all.has(name)) all.set(name, []);
      if (avg != null) all.get(name).push(avg);
    }
  }
  return [...all].map(([name, xs]) => ({ name, norm: normalize(name), avg: xs.length ? mean(xs) : null }));
}

/** Prefill values by match key: { key: { value, from } }. */
function buildPrefill(subjects) {
  const out = {};
  const ok = subjects.filter((s) => s.avg != null);
  const used = new Set();
  const put = (key, s) => {
    out[key] = { value: s.avg, from: s.name };
    used.add(s.name);
  };
  const take = (key, test) => {
    const s = ok.find((x) => !used.has(x.name) && test(x.norm));
    if (s) put(key, s);
  };

  const spes = ok.filter((s) => R.spe.test(s.norm));
  spes.slice(0, 3).forEach((s, i) => put(`spe${i + 1}`, s));
  const speMath = spes.find((s) => R.math.test(s.norm));

  take("lca", (n) => /\bLATIN\b|\bGREC\b|\bLCA\b/.test(n));
  ok.filter((s) => !used.has(s.name) && R.option.test(s.norm)).slice(0, 2).forEach((s, i) => put(`option${i + 1}`, s));
  take("philo", (n) => R.philo.test(n));
  take("french", (n) => R.french.test(n));
  take("emc", (n) => R.emc.test(n));
  take("hist", (n) => R.hist.test(n));
  take("eps", (n) => R.eps.test(n));
  take("sci", (n) => R.sci.test(n));
  take("lv1", (n) => /\bLV\s*[A1]\b|\bLVA\b|\bLV1\b/.test(n));
  take("lv2", (n) => /\bLV\s*[B2]\b|\bLVB\b|\bLV2\b/.test(n));
  if (!out.lv1) take("lv1", (n) => R.lv.test(n));
  if (!out.lv2) take("lv2", (n) => R.lv.test(n));
  take("math", (n) => R.math.test(n));

  // Épreuve anticipée de maths: spécialité maths, else the common maths course.
  const eam = speMath ?? ok.find((s) => s.name === out.math?.from);
  if (eam) out.eam = { value: eam.avg, from: eam.name };

  // Brevet: one science paper (physique-chimie, SVT, technologie).
  const sci = ok.filter((s) => !used.has(s.name) && (R.pc.test(s.norm) || R.svt.test(s.norm) || R.techno.test(s.norm)));
  if (sci.length) out["sciences-college"] = { value: mean(sci.map((s) => s.avg)), from: `moyenne de ${sci.map((s) => s.name).join(", ")}` };

  // Brevet contrôle continu: every compulsory subject counts the same.
  const compulsory = ok.filter((s) => !R.option.test(s.norm));
  if (compulsory.length) {
    out["brevet-cc"] = { value: mean(compulsory.map((s) => s.avg)), from: `moyenne de ${compulsory.length} matières (hors options)` };
  }
  return out;
}

function guessLevel(data) {
  const c = normalize(data.user?.className ?? "");
  return /^1|PREM/.test(c) ? "1re" : "Tle";
}

// ---- Computation ----

/** Weighted average. Optional items count only when filled; required empty items are "missing". */
function computeFlat(items, vals) {
  let points = 0;
  let known = 0;
  let total = 0;
  const missing = [];
  for (const it of items) {
    const coef = it.coef > 0 ? it.coef : 0;
    const v = vals[it.id];
    if (v == null) {
      if (!it.optional) {
        total += coef;
        if (coef > 0) missing.push(it);
      }
      continue;
    }
    total += coef;
    known += coef;
    points += v * coef;
  }
  return { avg: known > 0 ? points / known : null, points, maxPoints: total * 20, weight: total, missing };
}

/** Brevet: 40 % contrôle continu (+ option points above 10, capped at 20) and 60 % exams. */
function computeBrevet(def, vals) {
  const cc = vals.cc;
  const fac = vals.facultatif;
  const ccFinal = cc == null ? null : Math.min(20, cc + (fac != null ? Math.max(0, fac - 10) : 0));
  const exams = def.items.filter((i) => i.group === "exam");
  const examCoefs = exams.reduce((a, i) => a + i.coef, 0);
  const flat = [
    { ...def.items.find((i) => i.id === "cc"), coef: def.ccWeight * 100 },
    ...exams.map((i) => ({ ...i, coef: (def.examWeight * 100 * i.coef) / examCoefs })),
  ];
  const r = computeFlat(flat, { ...vals, cc: ccFinal });
  const ex = computeFlat(exams, vals);
  return { ...r, points: null, ccFinal, examAvg: ex.missing.length ? null : ex.avg };
}

function compute(def, items, vals) {
  const r = def.scheme === "brevet" ? computeBrevet(def, vals) : computeFlat(items, vals);
  if (def.proFlag) {
    const pro = computeFlat(items.filter((i) => i.pro), vals);
    r.proAvg = pro.missing.length ? null : pro.avg;
  }
  r.complete = r.missing.length === 0 && r.avg !== null;
  return r;
}

/**
 * Minimum mark x (same mark in every selected item) so that the average reaches target.
 * Solved numerically (the brevet option cap makes it non-linear). Rounded up to 0.01.
 */
function solve(avgOf, vals, ids, target) {
  const f = (x) => avgOf({ ...vals, ...Object.fromEntries(ids.map((id) => [id, x])) });
  const eps = 1e-9;
  const lo = f(0);
  const hi = f(20);
  if (lo == null || hi == null) return null;
  if (lo >= target - eps) return { status: "done" };
  if (hi < target - eps) return { status: "impossible", best: hi };
  let a = 0;
  let b = 20;
  for (let i = 0; i < 50; i++) {
    const m = (a + b) / 2;
    if (f(m) >= target - eps) b = m;
    else a = m;
  }
  return { status: "need", x: Math.min(20, Math.ceil(b * 100 - 1e-6) / 100) };
}

function targetsFor(def, custom) {
  const list = [];
  if (def.pass != null) list.push({ label: "Obtenir le diplôme", min: def.pass });
  for (const m of def.mentions) list.push({ label: `Mention ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}`, min: m.min });
  if (custom != null && !list.some((t) => t.min === custom)) list.push({ label: "Ma cible", min: custom, custom: true });
  return list.sort((a, b) => a.min - b.min);
}

function mentionFor(def, avg) {
  let reached = null;
  for (const m of def.mentions) if (avg >= m.min) reached = m;
  return reached;
}

// ---- UI pieces ----

function sourcesLine(def, calc) {
  const year = def.session ? `session ${def.session}` : null;
  return h("footer", { class: "sim-sources muted small" },
    def.unverified.length
      ? h("ul", { class: "sim-unverified" },
          def.unverified.map((t) => h("li", {}, h("span", { class: "tag warn" }, "à vérifier"), " ", t)))
      : null,
    def.sources.length
      ? h("p", {},
          h("strong", {}, `Sources (${[calc.label, year].filter(Boolean).join(", ")} ; vérifié en ${RULES_CHECKED}) : `),
          def.sources.flatMap((s, i) => [i ? " · " : "", h("a", { href: s.url, target: "_blank", rel: "noreferrer noopener" }, s.label)]))
      : null,
    h("p", {}, "Simulation indicative : seul le jury de l'examen fait foi."),
  );
}

function coefText(def, item) {
  if (def.scheme === "brevet") {
    if (item.id === "cc") return "40 %";
    if (item.bonus) return "bonus";
    const total = def.items.filter((i) => i.group === "exam").reduce((a, i) => a + i.coef, 0);
    return `coef ${fmtNum(item.coef)} · ${fmtNum((def.examWeight * 100 * item.coef) / total, 1)} %`;
  }
  return `coef ${fmtNum(item.coef)}`;
}

// ---- The view ----

export default {
  id: "simulateurs",
  title: "Simulateurs",

  render(data, rerender) {
    // Keep focus/caret when the app re-renders (background refresh every minute).
    const active = document.activeElement;
    if (active?.id?.startsWith("sim-")) {
      const { id, selectionStart, selectionEnd } = active;
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el || el === document.activeElement) return;
        el.focus();
        try {
          el.setSelectionRange(selectionStart, selectionEnd);
        } catch {
          // not a text input
        }
      });
    }

    const u = ui();
    const calc = CALCULATORS.find((c) => c.id === u.calc) ?? CALCULATORS[0];
    const level = u.level ?? guessLevel(data);
    u.sessions ??= {};
    const defaultSession = calc.bac ? (level === "1re" ? 2028 : 2027) : calc.sessions.includes(2027) ? 2027 : calc.sessions[0];
    const session = calc.sessions.includes(u.sessions[calc.id]) ? u.sessions[calc.id] : defaultSession;
    const def = calc.build(session);
    const st = calcState(calc.id);

    const grades = data.grades;
    const periodsWithData = (grades?.periods ?? []).filter((p) => hasValues(periodAverages(grades, p.id)));
    const source = u.source === "year" || periodsWithData.some((p) => p.id === u.source) ? u.source ?? "year" : "year";
    const subjects = pronoteSubjects(grades, source);
    const prefill = buildPrefill(subjects);
    const hasPronote = subjects.some((s) => s.avg != null);

    const set = (change) => {
      Object.assign(u, change);
      persist();
      rerender();
    };

    // ---- Toolbars ----
    const toolbar = h("div", { class: "view-toolbar" },
      CALCULATORS.map((c) =>
        h("button", { type: "button", class: `chip ${c === calc ? "active" : ""}`, "aria-pressed": c === calc ? "true" : "false", onclick: () => set({ calc: c.id }) }, c.label)),
    );

    const options = h("div", { class: "view-toolbar sim-options" },
      def.session
        ? h("div", { class: "sim-seg", role: "group", "aria-label": "Session" },
            h("span", { class: "muted small" }, "Session"),
            calc.sessions.map((s) =>
              h("button", { type: "button", class: `chip ${s === session ? "active" : ""}`, onclick: () => set({ sessions: { ...u.sessions, [calc.id]: s } }) },
                String(s), s >= 2028 ? "*" : "")))
        : null,
      calc.bac
        ? h("div", { class: "sim-seg", role: "group", "aria-label": "Classe actuelle" },
            h("span", { class: "muted small" }, "Je suis en"),
            [["1re", "Première"], ["Tle", "Terminale"]].map(([v, label]) =>
              h("button", { type: "button", class: `chip ${v === level ? "active" : ""}`, onclick: () => set({ level: v }) }, label)))
        : null,
      def.scheme !== "custom" && periodsWithData.length
        ? h("label", { class: "sim-seg" },
            h("span", { class: "muted small" }, "Moyennes Pronote"),
            h("select", { onchange: (e) => set({ source: e.target.value }) },
              h("option", { value: "year", selected: source === "year" }, "Année (moyenne des périodes)"),
              periodsWithData.map((p) => h("option", { value: p.id, selected: p.id === source }, p.name))))
        : null,
    );

    // ---- Items and values ----
    let items;
    let rowsUI;
    if (def.scheme === "custom") {
      if (!Array.isArray(st.rows)) {
        st.rows = def.rowsTemplate.map((r, i) => ({ id: `r${i}`, label: r.label, coef: String(r.coef), mark: "", pro: Boolean(r.pro) }));
        persist();
      }
      items = st.rows.map((r) => ({ id: r.id, label: r.label || "Sans nom", coef: parseNum(r.coef) ?? 0, pro: r.pro }));
    } else {
      items = def.items;
    }

    const prefillFor = (item) => (item.match && (!item.year || item.year === level) ? prefill[item.match] ?? null : null);
    const rawValue = (item) => {
      if (def.scheme === "custom") return st.rows.find((r) => r.id === item.id)?.mark ?? "";
      const manual = st.values?.[item.id];
      if (manual !== undefined) return manual;
      const pf = prefillFor(item);
      return pf ? toInput(pf.value) : "";
    };
    const values = () => Object.fromEntries(items.map((it) => [it.id, markOrNull(rawValue(it))]));

    // Result / solver nodes, rebuilt on every keystroke.
    const resultBox = h("div", { class: "sim-result-body", "aria-live": "polite" });
    const solverChips = h("div", { class: "sim-pick" });
    const solverOut = h("div", {});
    st.custom ??= def.scheme === "custom" && !def.pass ? "12" : "";

    const update = () => {
      const vals = values();
      const r = compute(def, items, vals);
      resultBox.replaceChildren(...renderResult(def, items, vals, r).filter(Boolean));
      renderSolver(def, items, vals, r, st, solverChips, solverOut, update);
    };

    // ---- Form ----
    let form;
    if (def.scheme === "custom") {
      const row = (r) => {
        const markInput = h("input", {
          id: `sim-${calc.id}-${r.id}-mark`, type: "text", inputmode: "decimal", value: r.mark ?? "", placeholder: "–",
          class: validMark(parseNum(r.mark)) ? "" : "invalid", "aria-label": `Note ${r.label}`,
          oninput: (e) => {
            r.mark = e.target.value;
            e.target.classList.toggle("invalid", !validMark(parseNum(r.mark)));
            tag.hidden = !(r.from && parseNum(r.mark) === r.pfMark);
            persist();
            update();
          },
        });
        const tag = h("span", { class: "tag sim-src", title: r.from ? `Pronote : ${r.from}` : "", hidden: !(r.from && parseNum(r.mark) === r.pfMark) }, "Pronote");
        return h("li", { class: "sim-row custom" },
          h("div", { class: "sim-label" },
            h("input", {
              id: `sim-${calc.id}-${r.id}-label`, type: "text", value: r.label ?? "", class: "sim-name", "aria-label": "Nom de l'épreuve",
              oninput: (e) => {
                r.label = e.target.value;
                items.find((i) => i.id === r.id).label = r.label || "Sans nom";
                persist();
                update();
              },
            }),
            h("div", { class: "sim-sub" },
              tag,
              def.proFlag
                ? h("label", { class: "sim-check small" },
                    h("input", { type: "checkbox", checked: Boolean(r.pro), onchange: (e) => {
                      r.pro = e.target.checked;
                      items.find((i) => i.id === r.id).pro = r.pro;
                      persist();
                      update();
                    } }),
                    "épreuve professionnelle")
                : null,
            ),
          ),
          markInput,
          h("label", { class: "sim-coef-input" },
            h("span", { class: "muted small" }, "coef"),
            h("input", {
              id: `sim-${calc.id}-${r.id}-coef`, type: "text", inputmode: "decimal", value: r.coef ?? "1",
              class: validCoef(parseNum(r.coef)) ? "" : "invalid", "aria-label": `Coefficient ${r.label}`,
              oninput: (e) => {
                r.coef = e.target.value;
                const n = parseNum(r.coef);
                e.target.classList.toggle("invalid", !validCoef(n));
                items.find((i) => i.id === r.id).coef = validCoef(n) && n !== null ? n : 0;
                persist();
                update();
              },
            }),
          ),
          h("button", { type: "button", class: "icon-btn", title: "Retirer", "aria-label": `Retirer ${r.label}`, onclick: () => {
            st.rows = st.rows.filter((x) => x !== r);
            st.selected = (st.selected ?? []).filter((id) => id !== r.id);
            persist();
            rerender();
          } }, "×"),
        );
      };

      const importPronote = () => {
        const settings = store.state?.subjectSettings ?? {};
        const rows = [];
        subjects.forEach((s, i) => {
          if (s.avg == null) return;
          const { coef = 1, mode = "normal" } = settings[s.name] ?? {};
          if (mode === "excluded") return;
          const pfMark = Math.round(s.avg * 100) / 100;
          rows.push({ id: `p${Date.now().toString(36)}${i}`, label: s.name, coef: String(coef), mark: toInput(pfMark), pfMark, from: s.name });
        });
        if (!rows.length) return;
        st.rows = rows;
        st.selected = [];
        persist();
        rerender();
      };

      form = h("section", { class: "card sim-form" },
        h("h2", {}, def.pass != null ? "Épreuves" : "Notes et coefficients"),
        def.notes.map((t) => h("p", { class: "muted small" }, t)),
        h("ul", { class: "list sim-rows" }, st.rows.map(row)),
        h("div", { class: "sim-actions" },
          h("button", { type: "button", class: "secondary small-btn", onclick: () => {
            st.rows.push({ id: `r${Date.now().toString(36)}`, label: "", coef: "1", mark: "", pro: false });
            persist();
            rerender();
          } }, "+ Ajouter une ligne"),
          def.importPronote && hasPronote
            ? h("button", { type: "button", class: "secondary small-btn", title: "Remplace la liste par vos moyennes et coefficients de matières", onclick: importPronote },
                "Importer mes moyennes Pronote")
            : null,
          h("button", { type: "button", class: "secondary small-btn danger", onclick: () => {
            delete saved.calcs[calc.id];
            persist();
            rerender();
          } }, "Réinitialiser"),
        ),
      );
    } else {
      st.values ??= {};
      const row = (item) => {
        const pf = prefillFor(item);
        const tag = h("span", { class: "tag sim-src" });
        const reset = h("button", { type: "button", class: "link-btn small", title: pf ? `Revenir à la moyenne Pronote (${toInput(pf.value)})` : "" }, "↺ Pronote");
        const input = h("input", {
          id: `sim-${calc.id}-${item.id}`, type: "text", inputmode: "decimal", value: rawValue(item), placeholder: "–",
          "aria-label": `${item.label} (note sur 20)`,
        });
        const refreshRow = () => {
          const manual = st.values[item.id] !== undefined;
          const raw = rawValue(item);
          input.classList.toggle("invalid", !validMark(parseNum(raw)));
          const fromPronote = pf && (!manual || parseNum(raw) === Math.round(pf.value * 100) / 100);
          tag.hidden = !pf;
          tag.textContent = fromPronote ? "Pronote" : "modifié";
          tag.className = `tag sim-src ${fromPronote ? "" : "edited"}`;
          tag.title = pf ? `Pronote : ${pf.from} (${toInput(pf.value)})` : "";
          reset.hidden = !pf || !manual || fromPronote;
        };
        input.addEventListener("input", () => {
          st.values[item.id] = input.value;
          persist();
          refreshRow();
          update();
        });
        reset.addEventListener("click", () => {
          delete st.values[item.id];
          input.value = rawValue(item);
          persist();
          refreshRow();
          update();
        });
        refreshRow();
        return h("li", { class: "sim-row" },
          h("div", { class: "sim-label" },
            h("label", { for: input.id }, item.label),
            item.note ? h("span", { class: "muted small sim-note" }, item.note) : null,
            h("span", { class: "sim-sub" }, tag, reset),
          ),
          input,
          h("span", { class: "muted small sim-coef" }, coefText(def, item)),
        );
      };

      const groups = [...new Set(def.items.map((i) => i.group))];
      form = h("section", { class: "card sim-form" },
        h("h2", {}, "Mes notes"),
        h("p", { class: "muted small" },
          hasPronote
            ? calc.bac
              ? `Les champs marqués « Pronote » sont préremplis avec vos moyennes de cette année (${level === "1re" ? "Première" : "Terminale"}) ; tout reste modifiable. Les notes d'épreuves préremplies ne sont que des estimations.`
              : "Les champs marqués « Pronote » sont préremplis avec vos moyennes ; tout reste modifiable. Les notes d'épreuves préremplies ne sont que des estimations."
            : "Saisissez vos notes sur 20 (ou synchronisez Pronote pour préremplir)."),
        groups.map((g) => {
          const list = def.items.filter((i) => i.group === g);
          const coefs = list.filter((i) => !i.optional && i.coef).reduce((a, i) => a + i.coef, 0);
          return h("div", { class: "sim-group" },
            h("h3", {}, GROUPS[g] ?? g, coefs && def.scheme !== "brevet" ? h("span", { class: "muted small" }, ` · ${fmtNum(coefs)}`) : null),
            h("ul", { class: "list sim-rows" }, list.map(row)),
          );
        }),
        h("div", { class: "sim-actions" },
          h("button", { type: "button", class: "secondary small-btn danger", title: "Efface vos saisies et revient aux moyennes Pronote", onclick: () => {
            delete saved.calcs[calc.id];
            persist();
            rerender();
          } }, "Effacer mes saisies"),
        ),
        def.notes.map((t) => h("p", { class: "muted small" }, t)),
      );
    }

    // ---- Solver card (static part: custom target) ----
    const solver = h("section", { class: "card sim-solver" },
      h("h2", {}, "Il me faut combien en… ?"),
      h("p", { class: "muted small" }, "Choisissez une ou plusieurs épreuves : on calcule la note minimale à y avoir (la même dans chacune) pour atteindre chaque palier, les autres notes restant celles saisies."),
      solverChips,
      h("label", { class: "sim-target" },
        h("span", { class: "small" }, "Ma cible (moyenne /20)"),
        h("input", {
          id: `sim-${calc.id}-target`, type: "text", inputmode: "decimal", value: st.custom ?? "", placeholder: "ex. 15",
          oninput: (e) => {
            st.custom = e.target.value;
            e.target.classList.toggle("invalid", !validMark(parseNum(st.custom)));
            persist();
            update();
          },
        }),
      ),
      solverOut,
    );

    const result = h("section", { class: "card sim-result" }, h("h2", {}, "Résultat"), resultBox);
    update();

    return [
      toolbar,
      options,
      h("div", { class: "sim-layout" },
        h("div", { class: "sim-main" }, form),
        h("div", { class: "sim-side" }, result, solver),
      ),
      sourcesLine(def, calc),
    ];
  },
};

// ---- Result panel ----

function renderResult(def, items, vals, r) {
  const out = [];
  const filled = items.filter((i) => vals[i.id] != null).length;
  if (r.avg === null) {
    out.push(h("p", { class: "empty" }, "Saisissez au moins une note pour voir votre moyenne."));
    return out;
  }

  out.push(h("div", { class: "sim-figures" },
    h("div", {},
      h("div", { class: "muted small" }, r.complete ? "Moyenne" : "Moyenne provisoire"),
      h("div", { class: "big" }, `${r.complete ? "" : "≈ "}${fmtNum(r.avg)}`, h("span", { class: "muted sim-unit" }, " /20")),
    ),
    r.points != null && def.pass != null && r.complete
      ? h("div", {},
          h("div", { class: "muted small" }, "Points"),
          h("div", { class: "big small-big" }, fmtNum(r.points, 1), h("span", { class: "muted sim-unit" }, ` /${fmtNum(r.maxPoints)}`)))
      : null,
    def.scheme === "brevet"
      ? h("div", { class: "small" },
          h("div", {}, h("span", { class: "muted" }, "Contrôle continu "), r.ccFinal == null ? "–" : fmtNum(r.ccFinal), h("span", { class: "muted" }, " × 40 %")),
          h("div", {}, h("span", { class: "muted" }, "Épreuves "), r.examAvg == null ? "–" : fmtNum(r.examAvg), h("span", { class: "muted" }, " × 60 %")))
      : null,
    def.proFlag
      ? h("div", { class: "small" }, h("span", { class: "muted" }, "Épreuves pro. "), r.proAvg == null ? "–" : fmtNum(r.proAvg))
      : null,
  ));

  if (!r.complete) {
    out.push(h("p", { class: "small sim-missing" },
      `Calculée sur ${filled} note${filled > 1 ? "s" : ""}. Il manque : `,
      r.missing.map(chipLabel).join(", "),
      ". Utilisez « Il me faut combien » pour savoir ce qu'il vous faut dans ces épreuves."));
  }

  // Status: admitted / second group / failed, and mention.
  if (def.pass != null) {
    const avg = r.avg;
    const prefix = r.complete ? "" : "Si votre moyenne reste à ce niveau : ";
    let status;
    if (avg >= def.pass) {
      const m = mentionFor(def, avg);
      status = h("p", { class: "sim-status good" }, prefix, h("strong", {}, "Admis"), m ? ` — mention ${m.label.toLowerCase()}` : " — sans mention");
    } else if (def.secondGroup && avg >= def.secondGroup.min) {
      const { proMin } = def.secondGroup;
      const proOk = proMin == null || r.proAvg == null || r.proAvg >= proMin;
      status = proOk
        ? h("p", { class: "sim-status warn" }, prefix, h("strong", {}, def.proFlag ? "Épreuve de contrôle" : "Second groupe (rattrapage)"),
            proMin != null && r.proAvg == null ? ` (si la moyenne des épreuves professionnelles atteint ${proMin})` : "")
        : h("p", { class: "sim-status bad" }, prefix, h("strong", {}, "Ajourné"), ` — moyenne des épreuves professionnelles sous ${def.secondGroup.proMin}`);
    } else {
      status = h("p", { class: "sim-status bad" }, prefix, h("strong", {}, "Ajourné"));
    }
    out.push(status);

    // Next step.
    const steps = targetsFor(def, null);
    const next = steps.find((t) => t.min > avg + 1e-9);
    if (next) {
      const gap = next.min - avg;
      out.push(h("p", { class: "small" },
        `Prochain palier : ${next.label.toLowerCase()} (${fmtNum(next.min)}) — il manque `,
        h("strong", {}, `${fmtNum(gap)} point${gap >= 2 ? "s" : ""} de moyenne`),
        r.complete && r.points != null ? ` (soit ${fmtNum(gap * r.weight, 1)} points au total)` : "",
        "."));
    } else if (def.mentions.length) {
      out.push(h("p", { class: "small" }, "Plus haute mention atteinte."));
    }

    out.push(h("ul", { class: "list sim-steps" },
      steps.map((t) => {
        const ok = avg >= t.min - 1e-9;
        return h("li", { class: "row" },
          h("span", {}, t.label, h("span", { class: "muted" }, ` · ${fmtNum(t.min)}`)),
          ok
            ? h("span", { class: "sim-ok" }, "atteint")
            : h("span", { class: "muted small" },
                `+${fmtNum(t.min - avg)}`,
                r.complete && r.points != null ? ` (${fmtNum((t.min - avg) * r.weight, 1)} pts)` : ""),
        );
      })));
  }

  if (def.secondGroup && r.complete && r.avg < def.pass && r.avg >= def.secondGroup.min) {
    out.push(renderSecondGroup(def, items, vals, r));
  }
  if (def.secondGroup?.text) out.push(h("p", { class: "muted small" }, def.secondGroup.text));
  return out;
}

function renderSecondGroup(def, items, vals) {
  const avgOf = (v) => {
    const x = compute(def, items, v);
    return x.complete ? x.avg : null;
  };
  const eligible = items.filter((i) => i.secondGroup && vals[i.id] != null);
  if (!eligible.length) return null;
  return h("div", { class: "sim-rattrapage" },
    h("h3", {}, "Au rattrapage, avec un seul oral"),
    h("ul", { class: "list" },
      eligible.map((i) => {
        const s = solve(avgOf, vals, [i.id], def.pass);
        return h("li", { class: "row" },
          h("span", {}, i.label, h("span", { class: "muted small" }, ` (écrit ${fmtNum(vals[i.id])}, coef ${fmtNum(i.coef)})`)),
          solveText(s),
        );
      })),
  );
}

function solveText(s) {
  if (!s) return h("span", { class: "muted" }, "–");
  if (s.status === "done") return h("span", { class: "sim-ok" }, "déjà acquis");
  if (s.status === "impossible") return h("span", { class: "sim-ko" }, "impossible");
  return h("strong", { class: "sim-need" }, `${fmtNum(s.x)} /20`);
}

// ---- Solver ----

const chipLabel = (i) => (i.group === "cc1" ? `${i.label} (1re)` : i.group === "cc2" ? `${i.label} (Tle)` : i.label);

function renderSolver(def, items, vals, r, st, chips, out, update) {
  const pickable = items.filter((i) => !(i.coef === 0) || i.bonus);
  const valid = new Set(pickable.map((i) => i.id));
  let selected = (st.selected ?? []).filter((id) => valid.has(id));
  if (!selected.length) selected = r.missing.map((m) => m.id).filter((id) => valid.has(id));

  chips.replaceChildren(
    ...pickable.map((i) =>
      h("button", {
        type: "button",
        class: `chip small ${selected.includes(i.id) ? "active" : ""}`,
        "aria-pressed": selected.includes(i.id) ? "true" : "false",
        onclick: () => {
          const next = selected.includes(i.id) ? selected.filter((id) => id !== i.id) : [...selected, i.id];
          st.selected = next;
          persist();
          update();
        },
      }, chipLabel(i), vals[i.id] == null && !i.optional ? h("span", { class: "sim-dot", title: "sans note" }) : null),
    ),
  );

  if (!selected.length) {
    out.replaceChildren(h("p", { class: "muted small" }, "Touchez une épreuve ci-dessus."));
    return;
  }
  const blocking = r.missing.filter((m) => !selected.includes(m.id));
  if (blocking.length) {
    out.replaceChildren(h("p", { class: "small sim-missing" },
      "Il manque aussi une note pour : ", blocking.map(chipLabel).join(", "),
      ". Saisissez-la, ou sélectionnez aussi ces épreuves."));
    return;
  }

  const avgOf = (v) => {
    const x = compute(def, items, v);
    return x.complete ? x.avg : null;
  };
  const custom = parseNum(st.custom);
  const targets = targetsFor(def, custom !== null && validMark(custom) ? custom : null);
  if (!targets.length) {
    out.replaceChildren(h("p", { class: "muted small" }, "Indiquez une cible."));
    return;
  }
  const names = items.filter((i) => selected.includes(i.id)).map(chipLabel);
  out.replaceChildren(...[
    h("p", { class: "small" }, selected.length > 1 ? `Note minimale à avoir dans chacune de : ${names.join(", ")}` : `Note minimale en ${names[0]}`),
    h("ul", { class: "list sim-steps" },
      targets.map((t) => h("li", { class: `row ${t.custom ? "sim-custom" : ""}` },
        h("span", {}, t.label, h("span", { class: "muted" }, ` · ${fmtNum(t.min)}`)),
        solveText(solve(avgOf, vals, selected, t.min)),
      ))),
    def.mentions.length && def.secondGroup && !def.proFlag
      ? h("p", { class: "muted small" }, "Les mentions ne s'obtiennent qu'au premier groupe d'épreuves.")
      : null,
  ].filter(Boolean));
}
