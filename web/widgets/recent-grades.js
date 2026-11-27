import { h, div, li, span, subjectName, gradeText, diffWithAverage, fmtNum, emptyState, relativeDay } from "../lib.js";

function deltaClass(diff) {
  return `delta ${diff >= 0 ? "up" : "down"}`;
}

export default {
  type: "recent-grades",
  title: "Dernières notes",
  description: "Vos dernières notes et l'écart avec la moyenne de la classe.",
  needs: ["grades"],
  defaults: { count: 5, showDelta: true },
  settings: [
    { key: "count", label: "Nombre de notes", type: "number", min: 1, max: 20 },
    { key: "showDelta", label: "Comparer à la classe", type: "boolean" },
  ],

  render({ grades }, settings) {
    const all = Object.values(grades?.byPeriod ?? {}).flatMap((p) => p.grades ?? []);
    // The same grade can appear in several periods (semester + year): dedupe by id.
    const unique = [...new Map(all.map((g) => [g.id, g])).values()];
    const latest = unique.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, settings.count);
    if (!latest.length) return emptyState("Aucune note pour l'instant.");

    return [
      h("ul", { class: "list" },
        latest.map((g) => {
          // Gap with the class on the grade's own scale (out of 10 for a mark out of 10).
          const diff = settings.showDelta ? diffWithAverage(g) : null;
          return li({ class: "row" },
            div({},
              div({ class: "subject" }, subjectName(g.subject?.name)),
              div({ class: "muted small" }, [relativeDay(new Date(g.date)), g.comment].filter(Boolean).join(" · ")),
            ),
            div({ class: "grade" },
              span( { class: "grade-value" }, gradeText(g.value), 
              span( { class: "muted" }, `/${gradeText(g.outOf)}`)),
              diff !== null 
                ? span({ class: deltaClass(diff) }, `${diff >= 0 ? "+" : ""}${fmtNum(diff, 1)} vs classe`) 
                : null,
            ),
          );
        }),
      ),
      h("a", { class: "more", href: "#/notes" }, "Toutes les notes →"),
    ];
  },
};
