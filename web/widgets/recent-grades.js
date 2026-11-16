import { h, subjectName, gradeText, on20, isNumber, fmtNum, emptyState, relativeDay } from "../lib.js";

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
          const mine = on20(g);
          const avg = isNumber(g.average) && isNumber(g.outOf) ? (g.average.points / g.outOf.points) * 20 : null;
          const diff = settings.showDelta && mine !== null && avg !== null ? mine - avg : null;
          return h("li", { class: "row" },
            h("div", {},
              h("div", { class: "subject" }, subjectName(g.subject?.name)),
              h("div", { class: "muted small" }, [relativeDay(new Date(g.date)), g.comment].filter(Boolean).join(" · ")),
            ),
            h("div", { class: "grade" },
              h("span", { class: "grade-value" }, gradeText(g.value), h("span", { class: "muted" }, `/${gradeText(g.outOf)}`)),
              diff !== null ? h("span", { class: `delta ${diff >= 0 ? "up" : "down"}` }, `${diff >= 0 ? "+" : ""}${fmtNum(diff, 1)} vs classe`) : null,
            ),
          );
        }),
      ),
      h("a", { class: "more", href: "#/notes" }, "Toutes les notes →"),
    ];
  },
};
