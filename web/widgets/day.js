import { h, classList, sameDay, startOfDay, addDays, formatDay, emptyState } from "../lib.js";
import { classItem } from "../components.js";

export default {
  type: "day",
  title: "Cours du jour",
  description: "La liste des cours d'aujourd'hui, ou du prochain jour de cours.",
  needs: ["timetable"],
  defaults: { which: "next", showCanceled: true },
  settings: [
    {
      key: "which",
      label: "Jour affiché",
      type: "select",
      options: [
        { value: "next", label: "Aujourd'hui puis le prochain jour de cours" },
        { value: "today", label: "Toujours aujourd'hui" },
        { value: "tomorrow", label: "Demain" },
      ],
    },
    { key: "showCanceled", label: "Afficher les cours annulés", type: "boolean" },
  ],

  render(data, settings) {
    const now = new Date();
    const classes = classList(data).filter((c) => settings.showCanceled || !c.canceled);
    let day;
    if (settings.which === "today") day = startOfDay(now);
    else if (settings.which === "tomorrow") day = addDays(startOfDay(now), 1);
    else day = classes.find((c) => c.endDate > now)?.startDate ?? now;

    const items = classes.filter((c) => sameDay(c.startDate, day));
    return [
      h("p", { class: "day" }, formatDay(day)),
      items.length ? h("ul", { class: "list" }, items.map((c) => classItem(c, { now }))) : emptyState("Pas de cours."),
    ];
  },
};
