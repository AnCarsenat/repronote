import { h, homeworkKey, emptyState, estimateAverage, overallAverage, subjectName, isNumber, fmtNum, startOfDay, startOfWeek, addDays } from "../lib.js";
import { lineChart, hBarChart, vBarChart } from "../charts.js";
import { store } from "../state.js";

let periodId = null;

/** Class average of an evaluation, as a grade (to reuse the same averaging rules). */
const asClassGrade = (g) => (isNumber(g.average) ? { ...g, value: g.average, isBonus: false, isOptional: false } : null);

function averagesAt(grades, settings) {
  const bySubject = new Map();
  for (const g of grades) {
    const k = subjectName(g.subject?.name);
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k).push(g);
  }
  const mine = [...bySubject].map(([name, list]) => ({ name, average: estimateAverage(list) }));
  const cls = [...bySubject].map(([name, list]) => ({ name, average: estimateAverage(list.map(asClassGrade).filter(Boolean)) }));
  return { me: overallAverage(mine, settings), cls: overallAverage(cls, settings), mine, clsBySubject: cls };
}

const tile = (label, value, sub, tone) =>
  h("div", { class: "stat-tile" },
    h("div", { class: "muted small" }, label),
    h("div", { class: `big ${tone ?? ""}` }, value),
    sub ? h("div", { class: "muted small" }, sub) : null);

export default {
  id: "stats",
  title: "Statistiques",

  render(data, rerender) {
    const settings = store.state?.subjectSettings ?? {};
    const grades = data.grades;
    const today = startOfDay(new Date());

    // ---- Grades ----
    const periods = (grades?.periods ?? []).filter((p) => grades.byPeriod[p.id]?.grades?.length);
    periodId ??= grades?.defaultPeriodId && grades.byPeriod[grades.defaultPeriodId]?.grades?.length ? grades.defaultPeriodId : periods[0]?.id;
    const overview = grades?.byPeriod?.[periodId];
    const list = [...(overview?.grades ?? [])].map((g) => ({ ...g, date: new Date(g.date) })).sort((a, b) => a.date - b.date);

    const evolution = { me: [], cls: [] };
    const dates = [...new Set(list.map((g) => +startOfDay(g.date)))];
    for (const d of dates) {
      const upTo = list.filter((g) => +startOfDay(g.date) <= d);
      const a = averagesAt(upTo, settings);
      if (a.me !== null) evolution.me.push({ x: new Date(d), y: a.me });
      if (a.cls !== null) evolution.cls.push({ x: new Date(d), y: a.cls });
    }
    const now = averagesAt(list, settings);
    // Per subject: Pronote's own averages when given, else ours.
    const subjectRows = (overview?.subjectsAverages?.length
      ? overview.subjectsAverages.map((s) => ({
          label: subjectName(s.subject.name),
          values: [isNumber(s.student) ? s.student.points : now.mine.find((m) => m.name === subjectName(s.subject.name))?.average, isNumber(s.class_average) ? s.class_average.points : null],
        }))
      : now.mine.map((m) => ({ label: m.name, values: [m.average, now.clsBySubject.find((c) => c.name === m.name)?.average] })))
      .filter((r) => Number.isFinite(r.values[0]))
      .sort((a, b) => b.values[0] - a.values[0]);

    const meNow = isNumber(overview?.overallAverage) ? overview.overallAverage.points : now.me;
    const clsNow = isNumber(overview?.classAverage) ? overview.classAverage.points : now.cls;
    const diff = meNow !== null && clsNow !== null ? meNow - clsNow : null;
    const trend = evolution.me.length > 1 ? evolution.me.at(-1).y - evolution.me[Math.max(0, evolution.me.length - 4)].y : null;

    // ---- Homework (archive = everything seen this year) ----
    const homework = Object.values({ ...Object.fromEntries(Object.values(data.homeworkArchive ?? {}).map((a) => [homeworkKey(a), a])), ...Object.fromEntries((data.homework ?? []).map((a) => [homeworkKey(a), a])) })
      .map((a) => ({ ...a, deadline: new Date(a.deadline) }));
    const firstWeek = startOfWeek(data.schoolYear?.firstDate ? new Date(data.schoolYear.firstDate) : addDays(today, -60));
    const lastWeek = startOfWeek(addDays(today, 28));
    const weeks = [];
    for (let w = firstWeek; w <= lastWeek; w = addDays(w, 7)) {
      const items = homework.filter((a) => a.deadline >= w && a.deadline < addDays(w, 7));
      weeks.push({
        label: w.toLocaleDateString("fr-FR", { day: "numeric", month: "numeric" }),
        title: `Semaine du ${w.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`,
        value: items.length,
        future: w > today,
        detail: items.length ? `${items.filter((a) => a.done).length} fait(s)` : null,
        current: +w === +startOfWeek(today),
      });
    }
    const pastWeeks = weeks.filter((w) => !w.future && !w.current);
    const perWeek = pastWeeks.length ? pastWeeks.reduce((n, w) => n + w.value, 0) / pastWeeks.length : null;
    const thisWeek = weeks.find((w) => w.current)?.value ?? 0;
    const due = homework.filter((a) => a.deadline < today);
    const doneRate = due.length ? (due.filter((a) => a.done).length / due.length) * 100 : null;
    const bySubject = new Map();
    for (const a of homework) bySubject.set(subjectName(a.subject?.name), (bySubject.get(subjectName(a.subject?.name)) ?? 0) + 1);
    const subjectWork = [...bySubject].map(([label, n]) => ({ label, values: [n] })).sort((a, b) => b.values[0] - a.values[0]);

    return [
      periods.length > 1
        ? h("div", { class: "view-toolbar" },
            periods.map((p) => h("button", { type: "button", class: `chip ${p.id === periodId ? "active" : ""}`, onclick: () => ((periodId = p.id), rerender()) }, p.name)))
        : null,
      h("section", { class: "card stat-tiles" },
        tile("Moyenne générale", meNow === null ? "–" : `${isNumber(overview?.overallAverage) ? "" : "≈ "}${fmtNum(meNow)}`, trend !== null ? `${trend >= 0 ? "↗" : "↘"} ${trend >= 0 ? "+" : ""}${fmtNum(trend, 2)} sur les dernières notes` : null),
        tile("Écart à la classe", diff === null ? "–" : `${diff >= 0 ? "+" : ""}${fmtNum(diff, 2)}`, clsNow !== null ? `classe ≈ ${fmtNum(clsNow)}` : null, diff === null ? "" : diff >= 0 ? "good" : "bad"),
        tile("Notes", String(list.length), periods.find((p) => p.id === periodId)?.name),
        tile("Devoirs cette semaine", String(thisWeek), perWeek !== null ? `moyenne ${fmtNum(perWeek, 1)} / semaine` : null),
        tile("Devoirs faits à temps", doneRate === null ? "–" : `${fmtNum(doneRate, 0)} %`, due.length ? `${due.length} devoirs passés` : null),
      ),
      h("div", { class: "stats-grid" },
        h("section", { class: "card" },
          h("h2", {}, "Évolution de la moyenne générale"),
          h("p", { class: "muted small" }, "Recalculée après chaque note, avec vos coefficients de matières. La classe : moyennes de classe de chaque évaluation."),
          lineChart([{ name: "Moi", points: evolution.me }, { name: "Classe", points: evolution.cls }], { label: "Évolution de la moyenne générale" })),
        h("section", { class: "card" },
          h("h2", {}, "Moyenne par matière"),
          subjectRows.length ? hBarChart(subjectRows, { series: [{ name: "Moi" }, { name: "Classe" }], max: 20 }) : emptyState("Pas de notes sur cette période.")),
        h("section", { class: "card" },
          h("h2", {}, "Devoirs par semaine"),
          h("p", { class: "muted small" }, `Depuis la rentrée${perWeek !== null ? ` · ${fmtNum(perWeek, 1)} en moyenne` : ""}. Les semaines à venir sont plus claires (encore incomplètes).`),
          vBarChart(weeks, { label: "Devoirs par semaine", highlight: weeks.find((w) => w.current)?.label, format: (v) => `${v} devoir${v > 1 ? "s" : ""}` })),
        h("section", { class: "card" },
          h("h2", {}, "Devoirs par matière"),
          hBarChart(subjectWork, { series: [{ name: "Devoirs" }], format: (v) => String(v) })),
      ),
    ];
  },
};
