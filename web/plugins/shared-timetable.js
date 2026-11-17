// "Emploi du temps partagé": swap timetables with friends (a share code or a
// file, nothing goes through any server), then see side by side who is in class
// and when everyone is free. Exports the shared week as a printable HTML page
// or the common free slots as a calendar (.ics).
import { h, classList, classTitle, startOfWeek, addDays, sameDay, formatShortDay, formatTime, inDuration, emptyState, DAY } from "../lib.js";
import { pluginData, savePluginData, downloadFile, data as currentData } from "../state.js";
import { getSettings } from "../settings.js";
import { weekPdf, rgb } from "../pdf.js";
import { inviteBlock } from "../invite.js";

const ID = "edt-partage";
const CODE_PREFIX = "RNEDT1:"; // gzip + base64url
const PLAIN_PREFIX = "RNEDT0:"; // base64url only (no CompressionStream)
// Okabe–Ito: colours people with colour-blindness can tell apart (colour-blind mode).
const SAFE_COLORS = ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#f0e442", "#000000"];
const COLORS = ["#5b5bd6", "#e5484d", "#12a594", "#f76b15", "#8e4ec6", "#0090ff", "#d6409f", "#46a758", "#ad7f58", "#3e63dd"];
const MIN_FREE = 30; // minutes: shorter gaps aren't worth listing

// ---- Saved state (on the local server) ----

function settings() {
  const s = pluginData(ID) ?? {};
  return {
    myName: typeof s.myName === "string" ? s.myName : "",
    details: s.details !== false,
    typical: s.typical !== false,
    hidden: Array.isArray(s.hidden) ? s.hidden : [],
    friends: Array.isArray(s.friends) ? s.friends : [],
  };
}
const save = (change) => savePluginData(ID, { ...settings(), ...change });

// ---- Share codes ----

const toB64 = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

async function encode(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "function") return CODE_PREFIX + toB64(await pipe(bytes, new CompressionStream("gzip")));
  return PLAIN_PREFIX + toB64(bytes);
}

async function decode(text) {
  const raw = String(text).trim();
  const m = /RNEDT([01]):([A-Za-z0-9_-]+)/.exec(raw);
  if (!m) throw new Error("Ce n'est pas un code d'emploi du temps repronote.");
  let bytes = fromB64(m[2]);
  if (m[1] === "1") {
    if (typeof DecompressionStream !== "function") throw new Error("Ce navigateur ne sait pas lire ce code.");
    bytes = await pipe(bytes, new DecompressionStream("gzip"));
  }
  const p = JSON.parse(new TextDecoder().decode(bytes));
  if (p?.v !== 1 || !Array.isArray(p.l)) throw new Error("Code illisible ou d'une version plus récente de repronote.");
  return {
    name: String(p.n ?? "Ami").slice(0, 40) || "Ami",
    sharedAt: Number(p.t) || Date.now(),
    // [start (minutes since 1970), duration (min), subject?, room?]
    lessons: p.l
      .filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > 0 && x[1] < 24 * 60)
      .slice(0, 5000)
      .map(([start, length, subject, room]) => [start, length, subject ? String(subject).slice(0, 60) : "", room ? String(room).slice(0, 30) : ""]),
  };
}

/** My upcoming/synced lessons, in the share format. Canceled classes count as free time. */
function myLessons(data, details) {
  return classList(data)
    .filter((c) => !c.canceled)
    .map((c) => [
      Math.round(c.startDate.getTime() / 60_000),
      Math.round((c.endDate - c.startDate) / 60_000),
      details ? classTitle(c) : "",
      details ? (c.classrooms ?? []).join(", ") : "",
    ]);
}

// ---- People and their lessons ----

const firstName = (full) => {
  const parts = String(full ?? "").trim().split(/\s+/);
  // Pronote writes "NOM Prénom": the first word not in capitals.
  return parts.find((p) => p !== p.toUpperCase()) ?? parts[0] ?? "";
};

function people(data, s) {
  const me = { id: "me", name: s.myName || firstName(data.user?.name) || "Moi", color: COLORS[0], lessons: myLessons(data, true), me: true };
  const list = [me, ...s.friends.map((f, i) => ({ ...f, color: f.color ?? COLORS[(i + 1) % COLORS.length] }))];
  const safe = getSettings().colorblind;
  return list.map((p, i) => ({ ...p, pat: i % 8, color: safe ? SAFE_COLORS[i % SAFE_COLORS.length] : p.color }));
}

const toLesson = ([start, length, subject, room]) => {
  const s = new Date(start * 60_000);
  return { start: s, end: new Date(s.getTime() + length * 60_000), subject, room };
};

/**
 * A person's lessons in the week starting `weekStart`. Outside the weeks they
 * shared, optionally their closest shared week, moved to this one ("semaine type").
 */
function weekOf(person, weekStart, typical) {
  const all = person.lessons.map(toLesson).sort((a, b) => a.start - b.start);
  if (!all.length) return { list: [], status: "none" };
  const end = addDays(weekStart, 7);
  const first = startOfWeek(all[0].start);
  const last = startOfWeek(all.at(-1).start);
  if (weekStart >= first && weekStart <= last) return { list: all.filter((l) => l.start >= weekStart && l.start < end), status: "real" };
  if (!typical) return { list: [], status: "missing" };
  const source = weekStart < first ? first : last;
  const days = Math.round((weekStart - source) / DAY);
  const moved = all
    .filter((l) => l.start >= source && l.start < addDays(source, 7))
    .map((l) => {
      const start = addDays(l.start, days);
      start.setHours(l.start.getHours(), l.start.getMinutes());
      return { ...l, start, end: new Date(start.getTime() + (l.end - l.start)) };
    });
  return { list: moved, status: "typical" };
}

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
const hm = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** Free intervals [from, to] (minutes of the day) when none of `lessons` happens. */
function freeSlots(lessons, dayStart, dayEnd) {
  const busy = lessons.map((l) => [minutesOfDay(l.start), minutesOfDay(l.end)]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let cursor = dayStart;
  for (const [from, to] of busy) {
    if (from > cursor) out.push([cursor, Math.min(from, dayEnd)]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < dayEnd) out.push([cursor, dayEnd]);
  return out.filter(([a, b]) => b - a >= MIN_FREE);
}

/** Everything the grid and the exports need for one week. */
function buildWeek(everyone, shown, weekStart, typical) {
  const rows = shown.map((p) => ({ p, ...weekOf(p, weekStart, typical) }));
  const all = rows.flatMap((r) => r.list);
  const hasSaturday = all.some((l) => l.start.getDay() === 6);
  const days = Array.from({ length: hasSaturday ? 6 : 5 }, (_, i) => addDays(weekStart, i));
  const startMin = all.length ? Math.floor(Math.min(...all.map((l) => minutesOfDay(l.start))) / 60) * 60 : 8 * 60;
  const endMin = all.length ? Math.ceil(Math.max(...all.map((l) => minutesOfDay(l.end))) / 60) * 60 : 17 * 60;
  const counted = rows.filter((r) => r.status === "real" || r.status === "typical");
  const free = days.map((d) => {
    const dayLessons = counted.flatMap((r) => r.list.filter((l) => sameDay(l.start, d)));
    // Only between the first class and the last one of the day (anyone's): before
    // and after school isn't news, nor a day without classes (holiday…).
    if (!dayLessons.length || counted.length < 2) return [];
    const from = Math.min(...dayLessons.map((l) => minutesOfDay(l.start)));
    const to = Math.max(...dayLessons.map((l) => minutesOfDay(l.end)));
    return freeSlots(dayLessons, from, to);
  });
  return { rows, days, startMin, endMin, free, counted };
}

// ---- Rendering ----

const PX = 0.9; // pixels per minute
let weekStart = null;
let phoneDay = null;
let message = null; // { kind: "ok" | "bad", text }
let pasted = "";
let myCode = "";
let busy = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The week grid, as a DOM tree (also serialized into the HTML export). */
function grid(week, { phone = null } = {}) {
  const { rows, days, startMin, endMin, free } = week;
  const colorblind = getSettings().colorblind;
  const height = (endMin - startMin) * PX;
  const lanes = rows.length;
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(h("div", { class: "sh-hour", style: { top: `${(m - startMin) * PX}px` } }, `${m / 60}h`));
  return h("div", { class: "sh-grid", style: { "--days": String(days.length), "--h": `${height}px` } },
    h("div", { class: "sh-axis" }, h("div", { class: "sh-head" }), h("div", { class: "sh-body" }, hours)),
    days.map((d, di) =>
      h("div", { class: `sh-col ${phone === null || phone === di ? "shown" : ""} ${sameDay(d, new Date()) ? "today" : ""}` },
        h("div", { class: "sh-head" }, d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })),
        h("div", { class: "sh-body" },
          free[di].map(([a, b]) =>
            h("div", { class: "sh-free", style: { top: `${(a - startMin) * PX}px`, height: `${(b - a) * PX}px` }, title: `Tout le monde est libre de ${hm(a)} à ${hm(b)}` },
              b - a >= 45 ? h("span", {}, "Libres") : null)),
          rows.flatMap((r, li) =>
            r.list.filter((l) => sameDay(l.start, d)).map((l) => {
              const top = (minutesOfDay(l.start) - startMin) * PX;
              const hgt = Math.max(10, ((l.end - l.start) / 60_000) * PX - 1);
              return h("div", {
                class: `sh-lesson ${r.status === "typical" ? "typical" : ""}`,
                "data-pat": String(r.p.pat),
                style: { top: `${top}px`, height: `${hgt}px`, left: `${(100 / lanes) * li}%`, width: `${100 / lanes}%`, "--c": r.p.color },
                title: [r.p.name, l.subject, `${formatTime(l.start)} – ${formatTime(l.end)}`, l.room, r.status === "typical" ? "(semaine type)" : ""].filter(Boolean).join("\n"),
              }, colorblind
                ? (hgt >= 13 ? h("span", {}, lanes > 3 || !l.subject ? r.p.name : `${r.p.name} · ${l.subject}`) : null)
                : hgt >= 26 && lanes <= 4 ? h("span", {}, l.subject || r.p.name) : null);
            })),
        ))),
  );
}

function freeList(week) {
  const lines = week.days.map((d, i) => [d, week.free[i]]).filter(([, f]) => f.length);
  if (week.counted.length < 2) return h("p", { class: "muted small" }, "Ajoutez au moins une autre personne pour voir les créneaux libres en commun.");
  if (!lines.length) return h("p", { class: "muted small" }, "Aucun créneau libre en commun cette semaine (d'au moins 30 min).");
  return h("ul", { class: "sh-free-list" },
    lines.map(([d, f]) =>
      h("li", {}, h("strong", {}, formatShortDay(d)), " ", f.map(([a, b]) => `${hm(a)}–${hm(b)} (${inDuration((b - a) * 60_000)})`).join(" · "))));
}

/** Who is in class right now, and until when. */
function nowLine(everyone, typical) {
  const now = new Date();
  const ws = startOfWeek(now);
  const parts = everyone.map((p) => {
    const { list, status } = weekOf(p, ws, typical);
    if (status === "none" || status === "missing") return null;
    const cur = list.find((l) => l.start <= now && now < l.end);
    return h("span", { class: `sh-now-chip ${cur ? "busy" : "free"}`, style: { "--c": p.color } },
      h("span", { class: "sh-dot", "data-pat": String(p.pat) }), p.name, " ", h("span", { class: "muted small" }, cur ? `en cours jusqu'à ${formatTime(cur.end)}` : "libre"));
  }).filter(Boolean);
  return parts.length ? h("div", { class: "sh-now" }, h("span", { class: "muted small" }, "Maintenant :"), parts) : null;
}

// ---- Exports ----

const EXPORT_CSS = `
body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#1c1c24;background:#fff}
h1{font-size:20px;margin:0 0 4px}.muted{color:#6b6b78}.small{font-size:12px}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:12px;height:12px;border-radius:3px;background:var(--c);display:inline-block}
.sh-grid{display:grid;grid-template-columns:44px repeat(var(--days),1fr);border:1px solid #ddd;border-radius:8px;overflow:hidden}
.sh-head{height:28px;line-height:28px;text-align:center;font-weight:600;font-size:12px;border-bottom:1px solid #ddd;background:#f6f6f9;text-transform:capitalize}
.sh-body{position:relative;height:var(--h)}.sh-col{border-left:1px solid #eee}
.sh-hour{position:absolute;right:4px;font-size:11px;color:#888;transform:translateY(-50%)}.sh-hour:first-child{transform:none}.sh-hour:last-child{transform:translateY(-100%)}
.sh-lesson{position:absolute;box-sizing:border-box;padding:2px 3px;font-size:10px;overflow:hidden;color:#fff;background:var(--c);border:1px solid #fff;border-radius:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sh-lesson.typical{opacity:.55}.sh-lesson span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh-free{position:absolute;left:0;right:0;background:repeating-linear-gradient(45deg,#d9f5e5,#d9f5e5 6px,#c4eed7 6px,#c4eed7 12px);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sh-free span{position:absolute;bottom:2px;left:4px;font-size:10px;color:#1a7f4b;font-weight:600}
ul{padding-left:18px}@media print{body{margin:8mm}}`;

function exportHTML(week, title) {
  const legend = week.rows.map((r) => `<span style="--c:${esc(r.p.color)}"><i></i>${esc(r.p.name)}${r.status === "typical" ? " <em class=\"muted small\">(semaine type)</em>" : r.status === "missing" ? " <em class=\"muted small\">(pas de données)</em>" : ""}</span>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${EXPORT_CSS}</style></head><body>
<h1>${esc(title)}</h1><p class="muted small">Exporté depuis repronote le ${esc(new Date().toLocaleString("fr-FR"))}. Zones hachurées vertes : tout le monde est libre.</p>
<div class="legend">${legend}</div>${grid(week).outerHTML}<h2 style="font-size:16px">Créneaux libres en commun</h2>${freeList(week).outerHTML}</body></html>`;
}

function exportPDF(week, title) {
  const lanes = week.rows.length;
  const blocks = week.rows.flatMap((r, lane) =>
    r.list.map((l) => {
      const day = week.days.findIndex((d) => sameDay(d, l.start));
      return day < 0 ? null : {
        day, lane, lanes,
        from: minutesOfDay(l.start),
        to: minutesOfDay(l.end),
        color: rgb(r.p.color),
        solid: true,
        faded: r.status === "typical",
        title: lanes > 3 ? r.p.name : l.subject || r.p.name,
        lines: [lanes > 3 ? l.subject : l.subject ? r.p.name : "", `${formatTime(l.start)}–${formatTime(l.end)}`, l.room].filter(Boolean),
      };
    }).filter(Boolean));
  const free = week.days.flatMap((_, day) => week.free[day].map(([from, to]) => ({ day, from, to })));
  const notes = week.counted.length > 1
    ? week.days.map((d, i) => [d, week.free[i]]).filter(([, f]) => f.length)
        .map(([d, f]) => `${formatShortDay(d)} : ${f.map(([a, b]) => `${hm(a)}–${hm(b)} (${inDuration((b - a) * 60_000)})`).join(" · ")}`)
    : [];
  return weekPdf({
    title,
    subtitle: `Exporté depuis repronote le ${new Date().toLocaleString("fr-FR")}. En vert : tout le monde est libre. Plus clair : semaine type.`,
    days: week.days, startMin: week.startMin, endMin: week.endMin, blocks, free,
    legend: [...week.rows.map((r) => ({ color: rgb(r.p.color), label: r.status === "typical" ? `${r.p.name} (semaine type)` : r.status === "missing" ? `${r.p.name} (pas de données)` : r.p.name })),
      { color: [0.85, 0.96, 0.9], label: "tout le monde libre" }],
    notes: { title: "Créneaux libres en commun", lines: notes.length ? notes : [week.counted.length > 1 ? "Aucun créneau libre en commun cette semaine (d'au moins 30 min)." : "Une seule personne affichée."] },
  });
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

/** Common free slots of every week where everyone shown has data. */
function exportICS(everyone, shown, typical) {
  const weeks = new Set();
  for (const p of shown) for (const l of p.lessons.map(toLesson)) weeks.add(startOfWeek(l.start).getTime());
  const events = [];
  const names = shown.map((p) => p.name).join(", ");
  for (const w of [...weeks].sort()) {
    const week = buildWeek(everyone, shown, new Date(w), typical);
    week.days.forEach((d, i) => {
      for (const [a, b] of week.free[i]) {
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, a);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, b);
        events.push(["BEGIN:VEVENT", `UID:${icsDate(start)}-${a}-${b}@repronote`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
          `SUMMARY:${icsText(`Libres ensemble`)}`, `DESCRIPTION:${icsText(names)}`, "TRANSP:TRANSPARENT", "END:VEVENT"].join("\r\n"));
      }
    });
  }
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//repronote//edt-partage//FR", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(`Libres ensemble : ${names}`)}`, ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
}

// ---- The plugin ----

export default {
  id: "edt-partage",
  title: "Emploi du temps partagé",
  description: "Échangez vos emplois du temps avec vos amis : qui est en cours, quand vous êtes libres ensemble. Export HTML ou calendrier.",
  icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2",

  render(data, rerender) {
    const s = settings();
    const everyone = people(data, s);
    const shown = everyone.filter((p) => !s.hidden.includes(p.id));
    const now = new Date();
    weekStart ??= startOfWeek(now.getDay() === 6 || now.getDay() === 0 ? addDays(now, 2) : now);
    const week = buildWeek(everyone, shown, weekStart, s.typical);
    phoneDay ??= Math.max(0, week.days.findIndex((d) => sameDay(d, now)));
    const phone = Math.min(phoneDay, week.days.length - 1);
    const say = (kind, text) => {
      message = { kind, text };
      rerender();
    };
    const go = (days) => {
      weekStart = addDays(weekStart, days);
      phoneDay = null;
      rerender();
    };

    const makeCode = async () => {
      busy = true;
      rerender();
      try {
        myCode = await encode({ v: 1, n: everyone[0].name, t: Date.now(), l: myLessons(currentData(), s.details) });
      } finally {
        busy = false;
        rerender();
      }
      return myCode;
    };
    const copyCode = async () => {
      const code = await makeCode();
      try {
        await navigator.clipboard.writeText(code);
        say("ok", "Code copié. Envoyez-le à vos amis (message, mail…) : ils le collent dans leur repronote.");
      } catch {
        say("ok", "Sélectionnez le code ci-dessous et copiez-le.");
      }
    };
    const importCode = async (text) => {
      try {
        const friend = await decode(text);
        if (!friend.lessons.length) throw new Error("Ce code ne contient aucun cours.");
        const cur = settings();
        const existing = cur.friends.find((f) => f.name.toLowerCase() === friend.name.toLowerCase());
        const used = new Set(cur.friends.map((f) => f.color));
        const color = existing?.color ?? COLORS.slice(1).find((c) => !used.has(c)) ?? COLORS[(cur.friends.length + 1) % COLORS.length];
        const entry = { id: existing?.id ?? `f${Date.now().toString(36)}`, color, ...friend };
        save({ friends: existing ? cur.friends.map((f) => (f === existing ? entry : f)) : [...cur.friends, entry] });
        pasted = "";
        say("ok", existing ? `Emploi du temps de ${friend.name} mis à jour.` : `${friend.name} ajouté(e).`);
      } catch (err) {
        say("bad", err.message || "Code illisible.");
      }
    };

    // -- Share mine --
    const shareCard = h("section", { class: "card" },
      h("h2", {}, "Partager le mien"),
      h("label", { class: "sh-field" }, h("span", { class: "muted small" }, "Mon nom pour les autres"),
        h("input", { id: "sh-myname", type: "text", maxlength: 40, value: s.myName, placeholder: everyone[0].name, onchange: (e) => ((myCode = ""), save({ myName: e.target.value.trim() })) })),
      h("label", { class: "sh-check" },
        h("input", { type: "checkbox", checked: s.details, onchange: (e) => ((myCode = ""), save({ details: e.target.checked })) }),
        "Inclure les matières et les salles (sinon : seulement les heures de cours)"),
      h("div", { class: "sh-actions" },
        h("button", { type: "button", disabled: busy || !everyone[0].lessons.length, onclick: copyCode }, "Copier mon code"),
        h("button", { type: "button", class: "secondary", disabled: busy || !everyone[0].lessons.length, onclick: async () => {
          const code = await makeCode();
          await downloadFile(`emploi-du-temps-${everyone[0].name}.txt`, "text/plain; charset=utf-8", code).catch(() => say("bad", "Téléchargement impossible : serveur local injoignable."));
        } }, "Télécharger (.txt)")),
      myCode ? h("textarea", { class: "sh-code", readonly: true, rows: 3, onfocus: (e) => e.target.select() }, myCode) : null,
      everyone[0].lessons.length
        ? h("p", { class: "muted small" }, "Le code contient les cours synchronisés (quelques semaines). Renvoyez-en un nouveau quand votre emploi du temps change.")
        : h("p", { class: "muted small" }, "Synchronisez d'abord votre emploi du temps."),
    );

    // -- Add a friend --
    const addCard = h("section", { class: "card" },
      h("h2", {}, "Ajouter un ami"),
      h("textarea", { id: "sh-paste", class: "sh-code", rows: 3, placeholder: "Collez ici le code reçu (RNEDT1:…)", oninput: (e) => (pasted = e.target.value) }, pasted),
      h("div", { class: "sh-actions" },
        h("button", { type: "button", onclick: () => importCode(pasted) }, "Ajouter"),
        h("label", { class: "button secondary" }, "Ouvrir un fichier",
          h("input", { type: "file", accept: ".txt,text/plain", hidden: true, onchange: async (e) => {
            const f = e.target.files?.[0];
            if (f) importCode(await f.text());
          } }))),
      message ? h("p", { class: message.kind === "ok" ? "good-text small" : "error-text small", role: "status" }, message.text) : null,
    );

    // -- People --
    const peopleCard = h("section", { class: "card wide" },
      h("h2", {}, `Personnes (${everyone.length})`),
      h("ul", { class: "sh-people" },
        everyone.map((p) => {
          const hidden = s.hidden.includes(p.id);
          const status = weekOf(p, weekStart, s.typical).status;
          return h("li", { class: `sh-person ${hidden ? "off" : ""}`, style: { "--c": p.color } },
            h("label", { class: "sh-person-main" },
              h("input", { type: "checkbox", checked: !hidden, "aria-label": `Afficher ${p.name}`, onchange: (e) =>
                save({ hidden: e.target.checked ? s.hidden.filter((x) => x !== p.id) : [...s.hidden, p.id] }) }),
              h("span", { class: "sh-dot", "data-pat": String(p.pat) }),
              h("strong", {}, p.name),
              p.me ? h("span", { class: "tag" }, "moi") : null),
            h("span", { class: "muted small" },
              p.me ? "votre emploi du temps synchronisé" : `partagé le ${new Date(p.sharedAt).toLocaleDateString("fr-FR")}`,
              status === "typical" ? " · semaine type" : status === "missing" ? " · pas de données cette semaine" : ""),
            p.me ? null : h("span", { class: "sh-person-actions" },
              getSettings().colorblind ? null : h("input", { type: "color", value: p.color, "aria-label": `Couleur de ${p.name}`, onchange: (e) =>
                save({ friends: settings().friends.map((f) => (f.id === p.id ? { ...f, color: e.target.value } : f)) }) }),
              h("button", { type: "button", class: "icon-btn", title: `Retirer ${p.name}`, "aria-label": `Retirer ${p.name}`, onclick: () => {
                if (confirm(`Retirer ${p.name} ?`)) save({ friends: settings().friends.filter((f) => f.id !== p.id), hidden: s.hidden.filter((x) => x !== p.id) });
              } }, "✕")));
        })),
      h("label", { class: "sh-check" },
        h("input", { type: "checkbox", checked: s.typical, onchange: (e) => save({ typical: e.target.checked }) }),
        "Semaine type : hors des semaines partagées, reprendre la semaine partagée la plus proche (affichée en plus clair)"),
    );

    // -- Week --
    const title = `Semaine du ${formatShortDay(weekStart)}`;
    const toolbar = h("div", { class: "view-toolbar" },
      h("button", { type: "button", class: "secondary small-btn", "aria-label": "Semaine précédente", onclick: () => go(-7) }, "←"),
      h("button", { type: "button", class: "secondary small-btn", onclick: () => ((weekStart = startOfWeek(now)), (phoneDay = null), rerender()) }, "Cette semaine"),
      h("button", { type: "button", class: "secondary small-btn", "aria-label": "Semaine suivante", onclick: () => go(7) }, "→"),
      h("span", { class: "muted" }, `du ${formatShortDay(weekStart)} au ${formatShortDay(week.days.at(-1))}`),
      h("span", { class: "sh-spacer" }),
      h("span", { class: "muted small" }, "Exporter :"),
      h("button", { type: "button", class: "secondary small-btn", disabled: !shown.length, onclick: () =>
        downloadFile(`edt-partage-${weekStart.toISOString().slice(0, 10)}.html`, "text/html; charset=utf-8", exportHTML(week, `Emploi du temps partagé — ${title.toLowerCase()}`))
          .catch(() => say("bad", "Export impossible : serveur local injoignable.")) }, "HTML"),
      h("button", { type: "button", class: "secondary small-btn", disabled: !shown.length, title: "La semaine en PDF (A4 paysage)", onclick: () =>
        downloadFile(`edt-partage-${weekStart.toISOString().slice(0, 10)}.pdf`, "application/pdf", exportPDF(week, `Emploi du temps partagé — ${title.toLowerCase()}`), { base64: true })
          .catch(() => say("bad", "Export impossible : serveur local injoignable.")) }, "PDF"),
      h("button", { type: "button", class: "secondary small-btn", disabled: shown.length < 2, title: "Les créneaux libres en commun, pour votre agenda", onclick: () =>
        downloadFile("libres-ensemble.ics", "text/calendar; charset=utf-8", exportICS(everyone, shown, s.typical))
          .catch(() => say("bad", "Export impossible : serveur local injoignable.")) }, "Libres (.ics)"),
    );

    const weekCard = h("section", { class: "card wide sh-week" },
      toolbar,
      nowLine(shown, s.typical),
      h("div", { class: "sh-legend" },
        week.rows.map((r) => h("span", { style: { "--c": r.p.color }, class: r.status === "missing" ? "off" : "" }, h("span", { class: "sh-dot", "data-pat": String(r.p.pat) }), r.p.name)),
        h("span", {}, h("span", { class: "sh-dot sh-free-dot" }), "tout le monde libre")),
      h("div", { class: "tt-daychips sh-daychips" },
        week.days.map((d, i) => h("button", { type: "button", class: `chip ${i === phone ? "active" : ""}`, onclick: () => ((phoneDay = i), rerender()) },
          d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })))),
      shown.length ? grid(week, { phone }) : emptyState("Cochez au moins une personne."),
      h("h3", {}, "Créneaux libres en commun"),
      freeList(week),
    );

    const inviteCard = h("section", { class: "card wide" },
      h("h2", {}, "Inviter un ami qui n'a pas repronote"),
      inviteBlock(rerender, { getCode: everyone[0].lessons.length ? () => encode({ v: 1, n: everyone[0].name, t: Date.now(), l: myLessons(currentData(), s.details) }) : null }));

    return h("div", { class: "grid sh" }, peopleCard, weekCard, shareCard, addCard, inviteCard);
  },
};
