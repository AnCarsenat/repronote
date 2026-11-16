import { h, emptyState, safeHTML, subjectName, subjectColor, startOfDay, formatDay, formatTime } from "../lib.js";
import { fileLink } from "../components.js";

let subject = "";

export default {
  id: "contenus",
  title: "Contenus",

  render(data, rerender) {
    const resources = (data.resources ?? [])
      .map((r) => ({ ...r, startDate: new Date(r.startDate), endDate: new Date(r.endDate) }))
      .filter((r) => r.contents?.length)
      .sort((a, b) => b.startDate - a.startDate);
    if (!resources.length) return emptyState("Aucun contenu de cours sur les 4 dernières semaines.");

    const subjects = [...new Set(resources.map((r) => subjectName(r.subject?.name)))].sort();
    const shown = resources.filter((r) => !subject || subjectName(r.subject?.name) === subject);

    const groups = new Map();
    for (const r of shown) {
      const key = startOfDay(r.startDate).getTime();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    return [
      h("div", { class: "view-toolbar" },
        h("select", { "aria-label": "Matière", onchange: (e) => ((subject = e.target.value), rerender()) },
          h("option", { value: "" }, "Toutes les matières"),
          subjects.map((s) => h("option", { value: s, selected: s === subject }, s))),
        h("span", { class: "muted small" }, "Cahier de textes : ce qui a été fait en cours, 4 semaines en arrière et 1 semaine en avant."),
      ),
      h("div", { class: "card wide" },
        [...groups].map(([day, list]) => [
          h("p", { class: "day" }, formatDay(new Date(day))),
          h("ul", { class: "list" },
            list.map((r) =>
              h("li", { class: "lesson", style: { "--subject": subjectColor(r) } },
                h("div", { class: "row" },
                  h("span", { class: "subject" }, subjectName(r.subject?.name)),
                  h("span", { class: "muted small" }, `${formatTime(r.startDate)} · ${(r.teachers ?? []).join(", ")}`),
                ),
                r.contents.map((c) =>
                  h("div", { class: "content-block" },
                    c.title || c.categoryText ? h("div", { class: "content-title" }, [c.categoryText, c.title].filter(Boolean).join(" — ")) : null,
                    c.description ? safeHTML(c.description) : null,
                    c.files?.length ? h("div", { class: "files" }, c.files.map((f) => fileLink(f))) : null,
                  ),
                ),
                r.haveAssignment ? h("div", { class: "muted small" }, "📝 Travail à faire donné pendant ce cours (voir Devoirs)") : null,
              ),
            ),
          ),
        ]),
      ),
    ];
  },
};
