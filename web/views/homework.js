import { h, startOfDay, addDays, startOfWeek, formatDay, emptyState, subjectName, homeworkKey } from "../lib.js";
import { homeworkItem } from "../components.js";
import { workloadChart } from "../charts.js";
import { fetchHomeworkRange, store } from "../state.js";

// Devoirs: an endless list. "À faire"/"Tout" scroll forward to the end of the
// school year, "Faits" scrolls back to its start. Each step loads 2 weeks.
const STEP_DAYS = 14;

let filter = "todo"; // "todo" | "all" | "done"
let subject = "";
const extra = new Map(); // homework loaded by scrolling, by id
let forwardUntil = null; // last day loaded going forward
let backwardFrom = null; // first day loaded going back
let loading = false;
let offlineHit = false;
let emptyStreak = 0; // consecutive loads that brought nothing: stop auto-loading after 2

const toItem = (a) => ({ ...a, deadline: new Date(a.deadline) });

function allHomework(data) {
  // By stable key: the same homework gets a new id every Pronote session.
  const byKey = new Map();
  for (const a of Object.values(data.homeworkArchive ?? {})) byKey.set(homeworkKey(a), a);
  for (const a of extra.values()) if (!byKey.has(homeworkKey(a))) byKey.set(homeworkKey(a), a);
  for (const a of data.homework ?? []) byKey.set(homeworkKey(a), a); // freshest (current ids)
  return [...byKey.values()].map(toItem);
}

function yearBounds(data) {
  const y = data.schoolYear;
  return {
    first: y?.firstDate ? startOfDay(new Date(y.firstDate)) : addDays(startOfDay(new Date()), -120),
    last: y?.lastDate ? startOfDay(new Date(y.lastDate)) : addDays(startOfDay(new Date()), 200),
  };
}

async function loadMore(direction, data, rerender) {
  if (loading) return;
  const today = startOfDay(new Date());
  const { first, last } = yearBounds(data);
  forwardUntil ??= addDays(today, 35);
  backwardFrom ??= addDays(today, -14);
  let from;
  let to;
  if (direction === "forward") {
    if (forwardUntil >= last) return;
    from = addDays(forwardUntil, 1);
    to = new Date(Math.min(+addDays(forwardUntil, STEP_DAYS), +last));
  } else {
    if (backwardFrom <= first) return;
    to = addDays(backwardFrom, -1);
    from = new Date(Math.max(+addDays(backwardFrom, -STEP_DAYS), +first));
  }
  loading = true;
  rerender();
  try {
    const { items, offline } = await fetchHomeworkRange(from, to);
    offlineHit ||= offline;
    emptyStreak = items.length ? 0 : emptyStreak + 1;
    for (const a of items) extra.set(a.id, a);
    if (direction === "forward") forwardUntil = to;
    else backwardFrom = from;
  } catch {
    offlineHit = true;
  } finally {
    loading = false;
    rerender();
  }
}

function skeleton() {
  return h("div", { class: "hw-skeleton", "aria-hidden": "true" },
    [0, 1, 2].map(() => h("div", { class: "skeleton-row" }, h("span", { class: "sk sk-box" }), h("span", { class: "sk-lines" }, h("span", { class: "sk sk-line" }), h("span", { class: "sk sk-line short" })))));
}

export default {
  id: "devoirs",
  title: "Devoirs",

  render(data, rerender) {
    const today = startOfDay(new Date());
    const { first, last } = yearBounds(data);
    const all = allHomework(data);
    const subjects = [...new Set(all.map((a) => subjectName(a.subject?.name)))].sort();
    const bySubject = (a) => !subject || subjectName(a.subject?.name) === subject;

    const backward = filter === "done";
    // Late = not done in the last 2 weeks (older unticked homework is history, not a to-do).
    const late = filter === "done" ? [] : all.filter((a) => !a.done && a.deadline < today && a.deadline >= addDays(today, -14) && bySubject(a)).sort((a, b) => a.deadline - b.deadline);
    const list = all
      .filter(bySubject)
      .filter((a) => (backward ? a.deadline < addDays(today, 1) && a.done : a.deadline >= today && (filter === "all" || !a.done)))
      .sort((a, b) => (backward ? b.deadline - a.deadline : a.deadline - b.deadline));
    const left = all.filter((a) => a.deadline >= today && !a.done && bySubject(a)).length;

    const loadedEdge = backward ? backwardFrom ?? addDays(today, -14) : forwardUntil ?? addDays(today, 35);
    const finished = backward ? loadedEdge <= first : loadedEdge >= last;

    // Group by week, then day.
    const weeks = new Map();
    for (const a of list) {
      const wk = startOfWeek(a.deadline).getTime();
      if (!weeks.has(wk)) weeks.set(wk, new Map());
      const days = weeks.get(wk);
      const d = startOfDay(a.deadline).getTime();
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(a);
    }

    const tab = (value, label) =>
      h("button", { type: "button", class: `chip ${filter === value ? "active" : ""}`, onclick: () => ((filter = value), (emptyStreak = 0), rerender(), window.scrollTo(0, 0)) }, label);

    const sentinel = finished || emptyStreak >= 2 ? null : h("div", { class: "hw-sentinel" });
    if (sentinel) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          loadMore(backward ? "backward" : "forward", data, rerender);
        }
      }, { rootMargin: "400px" });
      requestAnimationFrame(() => sentinel.isConnected && io.observe(sentinel));
    }

    const weekLabel = (wk) => {
      const start = new Date(wk);
      const thisWeek = startOfWeek(today).getTime();
      if (wk === thisWeek) return "Cette semaine";
      if (wk === addDays(new Date(thisWeek), 7).getTime()) return "Semaine prochaine";
      if (wk === addDays(new Date(thisWeek), -7).getTime()) return "Semaine dernière";
      return `Semaine du ${start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
    };

    return [
      h("div", { class: "view-toolbar sticky-toolbar" },
        tab("todo", `À faire (${left})`),
        tab("all", "Tout à venir"),
        tab("done", "Faits"),
        h("select", { "aria-label": "Matière", onchange: (e) => ((subject = e.target.value), rerender()) },
          h("option", { value: "" }, "Toutes les matières"),
          subjects.map((s) => h("option", { value: s, selected: s === subject }, s))),
      ),
      h("section", { class: "card wide" }, h("h2", {}, "Charge de travail (3 semaines)"), workloadChart(all, { days: 21 })),
      h("div", { class: "card wide hw-feed" },
        late.length ? [h("p", { class: "day late" }, `En retard (${late.length})`), h("ul", { class: "list" }, late.map((a) => homeworkItem(a, { showDate: true })))] : null,
        list.length || late.length
          ? [...weeks].map(([wk, days]) =>
              h("section", { class: "hw-week" },
                h("h3", { class: "hw-week-title" }, weekLabel(wk)),
                [...days].map(([d, items]) => [
                  h("p", { class: "day" }, `${backward ? "" : "Pour "}${formatDay(new Date(d))}`),
                  h("ul", { class: "list" }, items.map((a) => homeworkItem(a))),
                ]),
              ),
            )
          : loading ? null : emptyState(filter === "done" ? "Aucun devoir fait sur la période chargée." : "Rien à faire. 🎉"),
        loading ? skeleton() : null,
        sentinel,
        finished
          ? h("p", { class: "hw-end muted small" }, backward ? "— Début de l'année scolaire —" : "— Fin de l'année scolaire —")
          : !loading
            ? h("div", { class: "hw-more" },
                emptyStreak >= 2 ? h("span", { class: "muted small" }, `Rien jusqu'au ${loadedEdge.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}. `) : null,
                h("button", { type: "button", class: "secondary small-btn", onclick: () => ((emptyStreak = 0), loadMore(backward ? "backward" : "forward", data, rerender)) }, backward ? "Charger plus ancien" : "Charger la suite"))
            : null,
        offlineHit ? h("p", { class: "muted small" }, "Hors ligne : seuls les devoirs déjà vus sont affichés.") : null,
      ),
    ];
  },
};
