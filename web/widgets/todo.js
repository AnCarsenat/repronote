import { h, homeworkList, startOfDay, addDays, relativeDay, emptyState } from "../lib.js";
import { homeworkItem } from "../components.js";

export default {
  type: "todo",
  title: "À faire",
  description: "Les devoirs des prochains jours, à cocher. Les devoirs en retard en premier.",
  needs: ["homework"],
  defaults: { days: 4, showDone: false, showLate: true },
  settings: [
    { key: "days", label: "Nombre de jours", type: "number", min: 1, max: 21 },
    { key: "showDone", label: "Afficher les devoirs faits", type: "boolean" },
    { key: "showLate", label: "Afficher les devoirs en retard", type: "boolean" },
  ],

  render(data, settings) {
    const today = startOfDay(new Date());
    const limit = addDays(today, settings.days);
    const all = homeworkList(data);
    const late = settings.showLate ? all.filter((a) => !a.done && a.deadline < today) : [];
    const soon = all.filter((a) => a.deadline >= today && a.deadline < limit && (settings.showDone || !a.done));
    const left = all.filter((a) => a.deadline >= today && a.deadline < limit && !a.done).length;

    if (!late.length && !soon.length) return emptyState(`Rien à faire pour les ${settings.days} prochains jours. 🎉`);

    const groups = new Map();
    for (const a of soon) {
      const key = relativeDay(a.deadline);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }

    return [
      h("p", { class: "muted small" }, left ? `${left} devoir${left > 1 ? "s" : ""} à faire d'ici ${relativeDay(addDays(limit, -1))}` : "Tout est fait sur la période."),
      late.length ? [h("p", { class: "day late" }, "En retard"), h("ul", { class: "list" }, late.map((a) => homeworkItem(a, { showDate: true })))] : null,
      [...groups].map(([day, items]) => [
        h("p", { class: "day" }, `Pour ${day}`),
        h("ul", { class: "list" }, items.map((a) => homeworkItem(a))),
      ]),
      h("a", { class: "more", href: "#/devoirs" }, "Tous les devoirs →"),
    ];
  },
};
