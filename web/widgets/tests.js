import { h, subjectName, homeworkList, classList, startOfDay, addDays, relativeDay, formatTime, classTitle, looksLikeTest, htmlToText, emptyState, subjectColor } from "../lib.js";

export default {
  type: "tests",
  title: "Évaluations à venir",
  description: "Cours marqués « évaluation » et devoirs qui annoncent un contrôle.",
  needs: ["homework", "timetable"],
  defaults: { weeks: 3 },
  settings: [{ key: "weeks", label: "Nombre de semaines", type: "number", min: 1, max: 5 }],

  render(data, settings) {
    const today = startOfDay(new Date());
    const limit = addDays(today, settings.weeks * 7);
    const items = [];

    for (const c of classList(data)) {
      if (c.test && !c.canceled && c.startDate >= today && c.startDate < limit) {
        items.push({ date: c.startDate, subject: classTitle(c), detail: `En cours, ${formatTime(c.startDate)}`, color: subjectColor(c) });
      }
    }
    for (const a of homeworkList(data)) {
      if (looksLikeTest(a) && a.deadline >= today && a.deadline < limit) {
        const text = htmlToText(a.description);
        items.push({ date: a.deadline, subject: subjectName(a.subject?.name), detail: text.length > 110 ? `${text.slice(0, 110)}…` : text, color: subjectColor(a) });
      }
    }
    items.sort((a, b) => a.date - b.date);
    if (!items.length) return emptyState(`Aucune évaluation repérée sur ${settings.weeks} semaine${settings.weeks > 1 ? "s" : ""}.`);

    return h("ul", { class: "list" },
      items.map((i) =>
        h("li", { class: "test-item", style: { "--subject": i.color } },
          h("div", { class: "row" }, h("span", { class: "subject" }, i.subject), h("span", { class: "tag test" }, relativeDay(i.date))),
          h("div", { class: "desc" }, i.detail),
        ),
      ),
    );
  },
};
