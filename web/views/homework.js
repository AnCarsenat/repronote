import { h, homeworkList, startOfDay, formatDay, emptyState } from "../lib.js";
import { homeworkItem } from "../components.js";
import { workloadChart } from "../charts.js";

let filter = "todo"; // "todo" | "all" | "done"
let subject = "";

export default {
  id: "devoirs",
  title: "Devoirs",

  render(data, rerender) {
    const today = startOfDay(new Date());
    const all = homeworkList(data);
    const subjects = [...new Set(all.map((a) => a.subject?.name).filter(Boolean))].sort();

    const matches = (a) =>
      (!subject || a.subject?.name === subject) &&
      (filter === "all" || (filter === "todo" ? !a.done : a.done));

    const late = all.filter((a) => a.deadline < today && !a.done && matches(a));
    const upcoming = all.filter((a) => a.deadline >= today && matches(a));
    const past = filter === "todo" ? [] : all.filter((a) => a.deadline < today && a.done && matches(a)).reverse();
    const left = all.filter((a) => a.deadline >= today && !a.done).length;

    const tab = (value, label) =>
      h("button", { type: "button", class: `chip ${filter === value ? "active" : ""}`, onclick: () => ((filter = value), rerender()) }, label);

    const toolbar = h("div", { class: "view-toolbar" },
      tab("todo", `À faire (${left})`),
      tab("all", "Tout"),
      tab("done", "Faits"),
      h("select", { "aria-label": "Matière", onchange: (e) => ((subject = e.target.value), rerender()) },
        h("option", { value: "" }, "Toutes les matières"),
        subjects.map((s) => h("option", { value: s, selected: s === subject }, s)),
      ),
    );

    const byDay = (items) => {
      const groups = new Map();
      for (const a of items) {
        const key = startOfDay(a.deadline).getTime();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      }
      return [...groups].map(([day, list]) => [
        h("p", { class: "day" }, `Pour ${formatDay(new Date(day))}`),
        h("ul", { class: "list" }, list.map((a) => homeworkItem(a))),
      ]);
    };

    if (!late.length && !upcoming.length && !past.length) {
      return [toolbar, h("section", { class: "card wide" }, h("h2", {}, "Charge de travail (3 semaines)"), workloadChart(all, { days: 21 })), emptyState(filter === "todo" ? "Tout est fait. 🎉" : "Aucun devoir.")];
    }

    const chart = h("section", { class: "card wide" }, h("h2", {}, "Charge de travail (3 semaines)"), workloadChart(all, { days: 21 }));

    return [
      toolbar,
      chart,
      h("div", { class: "card wide" },
        late.length ? [h("p", { class: "day late" }, "En retard"), h("ul", { class: "list" }, late.map((a) => homeworkItem(a, { showDate: true })))] : null,
        byDay(upcoming),
        past.length ? [h("p", { class: "day muted" }, "Passés"), byDay(past)] : null,
      ),
    ];
  },
};
