// "Où gagner des points": for each subject, how much one more grade would move
// the overall average. Uses the same rules as the Notes page (grade and subject
// coefficients, bonus subjects) and flags subjects with a test coming up.
import { h, subjectName, isNumber, fmtNum, estimateAverage, overallAverage, emptyState, classList, homeworkList, looksLikeTest, formatShortDay, subjectColor } from "./lib.js";
import { store } from "./state.js";

const KEY = "repronote.points.v1";
let opts = load();
function load() {
  try {
    return { mark: 15, coef: 1, period: null, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { mark: 15, coef: 1, period: null };
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(opts));
  } catch {}
}

const num = (points) => ({ kind: 0, points });
const signed = (n) => `${n >= 0 ? "+" : "−"}${fmtNum(Math.abs(n), 2)}`;

/** Subjects of a period with their grades and averages (like the Notes page). */
function subjectsOf(grades, periodId, settings) {
  const ov = grades.byPeriod?.[periodId] ?? { grades: [], subjectsAverages: [] };
  const by = new Map();
  for (const s of ov.subjectsAverages ?? []) by.set(subjectName(s.subject.name), { info: s, list: [] });
  for (const g of ov.grades ?? []) {
    const k = subjectName(g.subject?.name);
    if (!by.has(k)) by.set(k, { info: null, list: [] });
    by.get(k).list.push(g);
  }
  return [...by].map(([name, { info, list }]) => {
    const official = isNumber(info?.student) ? info.student.points : null;
    const estimate = estimateAverage(list);
    return { name, info, list, estimate, average: official ?? estimate, coef: settings[name]?.coef ?? 1, mode: settings[name]?.mode ?? "normal" };
  });
}

/** Next test per subject in the coming 3 weeks (timetable flag or homework wording). */
function upcomingTests(data) {
  const now = Date.now();
  const limit = now + 21 * 864e5;
  const next = new Map();
  const note = (name, date) => {
    const k = subjectName(name);
    if (date.getTime() < now || date.getTime() > limit) return;
    if (!next.has(k) || next.get(k) > date) next.set(k, date);
  };
  for (const c of classList(data)) if (c.test && !c.canceled) note(c.subject?.name, c.startDate);
  for (const a of homeworkList(data)) if (looksLikeTest(a)) note(a.subject?.name, a.deadline);
  return next;
}

export function renderPoints(data, rerender) {
  const grades = data.grades;
  if (!grades?.periods?.length) return emptyState("Pas encore de notes synchronisées.");
  const withGrades = grades.periods.filter((p) => (grades.byPeriod?.[p.id]?.grades?.length ?? 0) > 0);
  if (!withGrades.length) return emptyState("Pas encore de notes sur cette année.");
  const period = withGrades.find((p) => p.id === opts.period) ?? withGrades.find((p) => p.id === grades.defaultPeriodId) ?? withGrades.at(-1);

  const settings = store.state?.subjectSettings ?? {};
  const subjects = subjectsOf(grades, period.id, settings).filter((s) => s.average !== null && s.mode !== "excluded" && s.coef > 0);
  const overall = overallAverage(subjects, settings);
  const tests = upcomingTests(data);
  const mark = Math.min(20, Math.max(0, Number(opts.mark) || 0));
  const coef = Math.max(0.1, Number(opts.coef) || 1);

  // Overall average if this subject got one more grade of `m`/20 (coefficient `coef`).
  const overallWith = (s, m) => {
    const fake = { value: num(m), outOf: num(20), coefficient: coef, isOutOf20: true };
    const newEstimate = estimateAverage([...s.list, fake]);
    // Pronote's own average may differ from our estimate: apply the estimated change to it.
    const newAvg = Math.min(20, Math.max(0, s.average + (newEstimate - (s.estimate ?? newEstimate))));
    return overallAverage(subjects.map((x) => (x === s ? { ...x, average: newAvg } : x)), settings);
  };

  const rows = subjects
    .map((s) => {
      const gain = overallWith(s, mark) - overall;
      const perPoint = overallWith(s, 20) - overallWith(s, 19); // value of one more point on that grade
      const best = overallWith(s, 20) - overall;
      return { s, gain, perPoint, best, test: tests.get(s.name) };
    })
    .sort((a, b) => b.gain - a.gain || b.perPoint - a.perPoint);
  const maxAbs = Math.max(0.0001, ...rows.map((r) => Math.abs(r.gain)));
  const top = rows[0];
  const topWithTest = rows.find((r) => r.test && r.gain > 0);

  const set = (change) => {
    Object.assign(opts, change);
    persist();
    rerender();
  };

  return [
    h("section", { class: "card wide points-intro" },
      h("h2", {}, "Où gagner le plus de points ?"),
      h("p", { class: "muted small" },
        "Pour chaque matière : ce que rapporterait une note de plus à votre moyenne générale. Une matière rapporte beaucoup quand son coefficient est fort, qu'elle a peu de notes, ou que votre moyenne y est basse. Les coefficients des matières se règlent dans Notes."),
      h("div", { class: "points-controls" },
        withGrades.length > 1
          ? h("label", {}, h("span", { class: "muted small" }, "Période"),
              h("select", { onchange: (e) => set({ period: e.target.value }) }, withGrades.map((p) => h("option", { value: p.id, selected: p.id === period.id }, p.name))))
          : null,
        h("label", {}, h("span", { class: "muted small" }, "Si j'ai"),
          h("span", { class: "points-input" },
            h("input", { id: "pts-mark", type: "number", min: 0, max: 20, step: 0.5, value: String(mark), onchange: (e) => set({ mark: e.target.value }) }),
            h("span", { class: "muted" }, "/20"))),
        h("label", {}, h("span", { class: "muted small" }, "coefficient de la note"),
          h("input", { id: "pts-coef", type: "number", min: 0.5, max: 10, step: 0.5, value: String(coef), onchange: (e) => set({ coef: e.target.value }) })),
      ),
      overall === null
        ? null
        : h("p", { class: "points-summary" },
            "Moyenne générale actuelle ", h("strong", {}, `≈ ${fmtNum(overall)}`), ". ",
            top && top.gain > 0
              ? ["Le plus rentable : ", h("strong", {}, top.s.name), ` (${signed(top.gain)} pour un ${fmtNum(mark, 1)}).`]
              : `Un ${fmtNum(mark, 1)} ne remonterait votre moyenne dans aucune matière : visez plus haut.`,
            topWithTest && topWithTest !== top
              ? [" Évaluation bientôt en ", h("strong", {}, topWithTest.s.name), ` (${formatShortDay(topWithTest.test)}) : ${signed(topWithTest.gain)}.`]
              : ""),
    ),
    h("section", { class: "card wide" },
      h("ul", { class: "points-list" },
        rows.map((r) =>
          h("li", { class: "points-row", style: { "--subject": subjectColor({ subject: { name: r.s.name }, backgroundColor: r.s.info?.backgroundColor }) } },
            h("div", { class: "points-name" },
              h("strong", {}, r.s.name),
              h("span", { class: "muted small" },
                `moyenne ${fmtNum(r.s.average)} · coef ${fmtNum(r.s.coef)}${r.s.mode === "bonus" ? " (bonus)" : ""} · ${r.s.list.length} note${r.s.list.length > 1 ? "s" : ""}`),
              r.test ? h("span", { class: "tag test" }, `Évaluation ${formatShortDay(r.test)}`) : null),
            h("div", { class: "points-bar", role: "img", "aria-label": `${signed(r.gain)} de moyenne générale` },
              h("span", { class: `points-fill ${r.gain < 0 ? "neg" : ""}`, style: { width: `${(Math.abs(r.gain) / maxAbs) * 100}%` } })),
            h("div", { class: "points-gain" },
              h("strong", { class: r.gain < 0 ? "bad-text" : "good-text" }, signed(r.gain)),
              h("span", { class: "muted small" }, `jusqu'à ${signed(r.best)} avec 20 · ${signed(r.perPoint)} par point`)),
          ))),
    ),
  ];
}
