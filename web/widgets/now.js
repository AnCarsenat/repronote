import { h, classList, classTitle, inDuration, relativeDay, formatTime, sameDay, emptyState, subjectColor } from "../lib.js";

export default {
  type: "now",
  title: "Maintenant",
  description: "Le cours en cours, le prochain et quand finit la journée.",
  needs: ["timetable"],
  defaults: { showRoom: true, showEndOfDay: true },
  settings: [
    { key: "showRoom", label: "Afficher la salle", type: "boolean" },
    { key: "showEndOfDay", label: "Afficher la fin de journée", type: "boolean" },
  ],

  render(data, settings) {
    const now = new Date();
    const classes = classList(data).filter((c) => !c.canceled);
    const current = classes.find((c) => c.startDate <= now && now < c.endDate);
    const next = classes.find((c) => c.startDate > now);
    if (!current && !next) return emptyState("Aucun cours prévu.");

    const remainingToday = classes.filter((c) => c.startDate > now && sameDay(c.startDate, now));
    const endOfDay = classes.filter((c) => sameDay(c.startDate, now)).at(-1)?.endDate;
    const block = (c, label, when) =>
      h("div", { class: "now-block", style: { "--subject": subjectColor(c) } },
        h("div", { class: "muted small" }, label),
        h("div", { class: "now-title" }, classTitle(c)),
        h("div", { class: "muted" }, [when, settings.showRoom ? (c.classrooms ?? []).join(", ") : null].filter(Boolean).join(" · ")),
      );

    return [
      current ? block(current, "En cours", `jusqu'à ${formatTime(current.endDate)} (${inDuration(current.endDate - now)})`) : null,
      next
        ? block(next, "Prochain cours",
            sameDay(next.startDate, now)
              ? `à ${formatTime(next.startDate)}, dans ${inDuration(next.startDate - now)}`
              : `${relativeDay(next.startDate)} à ${formatTime(next.startDate)}`)
        : null,
      settings.showEndOfDay && endOfDay && endOfDay > now
        ? h("p", { class: "muted small" },
            `${remainingToday.length} cours restant${remainingToday.length > 1 ? "s" : ""} aujourd'hui · fin à ${formatTime(endOfDay)}`)
        : null,
    ];
  },
};
