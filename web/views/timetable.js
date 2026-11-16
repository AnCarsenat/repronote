import { openClassDetails } from "../components.js";
import { h, classList, classTitle, startOfWeek, addDays, sameDay, formatShortDay, formatTime, inDuration, emptyState, subjectColor, DAY } from "../lib.js";

// Fixed scale: gaps show at their real size.
const PX_PER_MIN = 1.05;
const MIN_GAP_LABEL = 50; // minutes

let weekStart = null; // Monday of the week shown
let phoneDay = null; // day index shown on phones

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

/** Side-by-side lanes for overlapping classes (e.g. canceled + replacement). */
function withLanes(items) {
  const out = [];
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = [];
    for (const c of cluster) {
      let lane = lanes.findIndex((end) => end <= c.startDate.getTime());
      if (lane === -1) lane = lanes.push(0) - 1;
      lanes[lane] = c.endDate.getTime();
      out.push({ c, lane });
    }
    for (const o of out.slice(-cluster.length)) o.lanes = lanes.length;
    cluster = [];
  };
  for (const c of items) {
    if (cluster.length && c.startDate.getTime() >= clusterEnd) flush();
    cluster.push(c);
    clusterEnd = Math.max(clusterEnd, c.endDate.getTime());
  }
  if (cluster.length) flush();
  return out;
}

function classBlock({ c, lane, lanes }, dayStartMin, now) {
  const top = (minutesOfDay(c.startDate) - dayStartMin) * PX_PER_MIN;
  const height = Math.max(18, ((c.endDate - c.startDate) / 60_000) * PX_PER_MIN - 2);
  const short = height < 46;
  const where = (c.classrooms ?? []).join(", ");
  const state = [
    c.canceled && "canceled",
    c.endDate <= now && "past",
    c.startDate <= now && now < c.endDate && "current",
    c.test && "test",
    short && "short",
  ].filter(Boolean).join(" ");

  return h("div", {
    class: `tt-block ${state}`,
    style: {
      top: `${top}px`,
      height: `${height}px`,
      left: `calc(${(100 / lanes) * lane}% + 2px)`,
      width: `calc(${100 / lanes}% - 4px)`,
      "--subject": subjectColor(c),
    },
    title: [classTitle(c), `${formatTime(c.startDate)} – ${formatTime(c.endDate)}`, where, ...(c.teacherNames ?? []), c.status].filter(Boolean).join("\n"),
    tabindex: "0",
    role: "button",
    onclick: () => openClassDetails(c),
    onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openClassDetails(c)),
  },
    h("div", { class: "tt-title" }, classTitle(c), short && where ? h("span", { class: "tt-room" }, ` · ${where}`) : null),
    short
      ? null
      : h("div", { class: "tt-meta" }, where ? h("strong", { class: "tt-room" }, where) : null, ` ${formatTime(c.startDate)}–${formatTime(c.endDate)}`),
    !short && (c.status || c.test)
      ? h("div", { class: "tags" },
          c.status ? h("span", { class: `tag ${c.canceled ? "warn" : ""}` }, c.status) : null,
          c.test ? h("span", { class: "tag test" }, "Évaluation") : null,
        )
      : null,
  );
}

/** Labels for free time between classes ("Pause 1 h 05"). */
function gapLabels(items, dayStartMin) {
  const active = items.filter((c) => !c.canceled);
  const out = [];
  for (let i = 1; i < active.length; i++) {
    const prevEnd = Math.max(...active.slice(0, i).map((c) => c.endDate.getTime()));
    const gap = (active[i].startDate.getTime() - prevEnd) / 60_000;
    if (gap >= MIN_GAP_LABEL) {
      const top = (minutesOfDay(new Date(prevEnd)) - dayStartMin) * PX_PER_MIN;
      out.push(h("div", { class: "tt-gap", style: { top: `${top}px`, height: `${gap * PX_PER_MIN}px` } }, `Pause ${inDuration(gap * 60_000)}`));
    }
  }
  return out;
}

export default {
  id: "edt",
  title: "Emploi du temps",

  render(data, rerender) {
    const now = new Date();
    const classes = classList(data);
    weekStart ??= startOfWeek(now.getDay() === 6 || now.getDay() === 0 ? addDays(now, 2) : now);

    const first = classes[0] && startOfWeek(classes[0].startDate);
    const last = classes.at(-1) && startOfWeek(classes.at(-1).startDate);
    const go = (days) => {
      weekStart = addDays(weekStart, days);
      phoneDay = null;
      rerender();
    };

    const weekEnd = addDays(weekStart, 7);
    const ofWeek = classes.filter((c) => c.startDate >= weekStart && c.startDate < weekEnd);
    const hasSaturday = ofWeek.some((c) => c.startDate.getDay() === 6);
    const days = Array.from({ length: hasSaturday ? 6 : 5 }, (_, i) => addDays(weekStart, i));
    const holiday = (data.holidays ?? []).find(
      (hd) => new Date(hd.startDate) < weekEnd && new Date(hd.endDate).getTime() + DAY > weekStart.getTime(),
    );
    phoneDay ??= Math.max(0, days.findIndex((d) => sameDay(d, now)));

    const nav = h("div", { class: "view-toolbar" },
      h("button", { type: "button", class: "secondary small-btn", disabled: first && weekStart <= first, onclick: () => go(-7) }, "←"),
      h("button", { type: "button", class: "secondary small-btn", onclick: () => ((weekStart = startOfWeek(now)), (phoneDay = null), rerender()) }, "Cette semaine"),
      h("button", { type: "button", class: "secondary small-btn", disabled: last && weekStart >= last, onclick: () => go(7) }, "→"),
      h("span", { class: "muted" }, `du ${formatShortDay(weekStart)} au ${formatShortDay(addDays(weekStart, days.length - 1))}`),
    );

    if (!classes.length) return [nav, emptyState("Pas encore d'emploi du temps synchronisé.")];
    if (!ofWeek.length) {
      return [nav, emptyState(holiday ? `Vacances : ${holiday.name}` : "Aucun cours cette semaine (hors de la période synchronisée ?).")];
    }

    // Same vertical range for every day of the week, on whole hours.
    const startMin = Math.floor(Math.min(...ofWeek.map((c) => minutesOfDay(c.startDate))) / 60) * 60;
    const endMin = Math.ceil(Math.max(...ofWeek.map((c) => minutesOfDay(c.endDate))) / 60) * 60;
    const heightPx = (endMin - startMin) * PX_PER_MIN;

    const hours = [];
    for (let m = startMin; m <= endMin; m += 60) {
      hours.push(h("div", { class: "tt-hour", style: { top: `${(m - startMin) * PX_PER_MIN}px` } }, `${m / 60}h`));
    }

    const nowLine =
      days.some((d) => sameDay(d, now)) && minutesOfDay(now) >= startMin && minutesOfDay(now) <= endMin
        ? (minutesOfDay(now) - startMin) * PX_PER_MIN
        : null;

    const dayTabs = h("div", { class: "tt-daytabs" },
      days.map((d, i) =>
        h("button", { type: "button", class: `chip ${i === phoneDay ? "active" : ""}`, onclick: () => ((phoneDay = i), rerender()) },
          d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })),
      ),
    );

    return [
      nav,
      holiday ? h("p", { class: "banner info" }, `Vacances / férié : ${holiday.name}`) : null,
      dayTabs,
      h("div", { class: "tt", style: { "--days": String(days.length), "--tt-height": `${heightPx}px`, "--hour-px": `${60 * PX_PER_MIN}px` } },
        h("div", { class: "tt-axis" }, h("div", { class: "tt-head" }), h("div", { class: "tt-body" }, hours)),
        days.map((day, i) => {
          const items = ofWeek.filter((c) => sameDay(c.startDate, day));
          const isToday = sameDay(day, now);
          return h("div", { class: `tt-col ${isToday ? "today" : ""} ${i === phoneDay ? "phone-shown" : ""}` },
            h("div", { class: "tt-head" }, day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })),
            h("div", { class: "tt-body" },
              gapLabels(items, startMin),
              withLanes(items).map((o) => classBlock(o, startMin, now)),
              isToday && nowLine !== null ? h("div", { class: "tt-now", style: { top: `${nowLine}px` } }) : null,
              items.length ? null : h("div", { class: "tt-empty" }, "Pas de cours"),
            ),
          );
        }),
      ),
    ];
  },
};
