// Homework workload chart: stacked bars per due day, "À faire" at the base
// (the part that matters), "Fait" on top. Colors are validated categorical
// slots (--series-1 / --series-2, see style.css); a legend, hover tooltips and
// a data table carry the identity too, never color alone.
import { h, startOfDay, addDays, subjectName, looksLikeTest } from "./lib.js";

const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...children.flat().filter(Boolean));
  return el;
};

/** Rect with only the top corners rounded (data end), flat on the baseline. */
function topRounded(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

const dayLabel = (d) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }).replace(".", "");

/**
 * @param list homework items with Date deadlines
 * @param days how many calendar days from today
 */
export function workloadChart(list, { days = 14 } = {}) {
  const today = startOfDay(new Date());
  const buckets = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const items = list.filter((a) => startOfDay(a.deadline).getTime() === date.getTime());
    // Skip empty weekend days to keep bars wide.
    if ((date.getDay() === 0 || date.getDay() === 6) && !items.length) continue;
    buckets.push({ date, todo: items.filter((a) => !a.done), done: items.filter((a) => a.done) });
  }
  if (!buckets.length) return h("p", { class: "empty" }, "Aucun devoir sur la période.");

  const maxTotal = Math.max(1, ...buckets.map((b) => b.todo.length + b.done.length));
  const yMax = Math.max(3, maxTotal);
  const step = yMax > 6 ? 2 : 1;

  const tooltip = h("div", { class: "chart-tip", hidden: true });

  // Drawn at the real pixel width (redrawn on resize) so text keeps its size.
  const draw = (W) => {
  const H = 200;
  const m = { l: 26, r: 6, t: 8, b: 26 };
  const plotW = W - m.l - m.r;
  const plotH = H - m.t - m.b;
  const band = plotW / buckets.length;
  const barW = Math.min(30, band * 0.62);
  const y = (v) => m.t + plotH - (v / yMax) * plotH;
  const GAP = 2;

  const grid = [];
  for (let v = 0; v <= yMax; v += step) {
    grid.push(
      s("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "gridline" }),
      s("text", { x: m.l - 6, y: y(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, String(v)),
    );
  }

  const bars = [];
  // Labels need ~44px each ("mer 25"); thin them out when bars are narrow.
  const labelEvery = Math.ceil(44 / band);

  buckets.forEach((b, i) => {
    const cx = m.l + band * i + band / 2;
    const x = cx - barW / 2;
    const nTodo = b.todo.length;
    const nDone = b.done.length;
    const isToday = b.date.getTime() === today.getTime();

    // À faire from the baseline; Fait stacked above it, separated by a 2px surface gap.
    if (nTodo) {
      const top = y(nTodo);
      bars.push(s("path", { d: nDone ? `M${x},${y(0)}V${top}H${x + barW}V${y(0)}Z` : topRounded(x, top, barW, y(0) - top, 4), class: "bar-todo" }));
    }
    if (nDone) {
      const base = y(nTodo) - (nTodo ? GAP : 0);
      const top = y(nTodo + nDone);
      if (base > top) bars.push(s("path", { d: topRounded(x, top, barW, base - top, 4), class: "bar-done" }));
    }
    if (i % labelEvery === 0 || isToday) {
      bars.push(s("text", { x: cx, y: H - 8, class: `tick ${isToday ? "today" : ""}`, "text-anchor": "middle" }, isToday ? "auj." : dayLabel(b.date)));
    }

    // Hit target: the whole column, bigger than the bar.
    const hit = s("rect", { x: m.l + band * i, y: m.t, width: band, height: plotH, class: "hit", tabindex: "0" });
    const show = () => {
      const tests = [...b.todo, ...b.done].filter(looksLikeTest).length;
      tooltip.replaceChildren(
        h("strong", {}, b.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })),
        h("div", { class: "tip-row" }, h("span", { class: "swatch todo" }), `À faire : ${nTodo}`),
        h("div", { class: "tip-row" }, h("span", { class: "swatch done" }), `Fait : ${nDone}`),
        tests ? h("div", { class: "muted" }, `dont ${tests} évaluation${tests > 1 ? "s" : ""}`) : null,
        nTodo + nDone
          ? h("ul", {}, [...b.todo, ...b.done].map((a) => h("li", { class: a.done ? "muted" : "" }, subjectName(a.subject?.name))))
          : null,
      );
      tooltip.hidden = false;
      tooltip.style.left = `${(cx / W) * 100}%`;
      svg.querySelectorAll(".hit.active").forEach((el) => el.classList.remove("active"));
      hit.classList.add("active");
    };
    const hide = () => {
      tooltip.hidden = true;
      hit.classList.remove("active");
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    bars.push(hit);
  });

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart", role: "img", "aria-label": "Nombre de devoirs par jour d'échéance" }, grid, bars);
  return svg;
  };

  let width = 0;
  const area = h("div", { class: "chart-area" }, tooltip);
  const redraw = (w) => {
    w = Math.max(240, Math.round(w));
    if (Math.abs(w - width) < 4) return;
    width = w;
    area.querySelector("svg")?.remove();
    area.prepend(draw(w));
  };
  redraw(640);
  new ResizeObserver(([entry]) => redraw(entry.contentRect.width)).observe(area);

  const totalTodo = buckets.reduce((n, b) => n + b.todo.length, 0);
  const busiest = buckets.reduce((a, b) => (b.todo.length > a.todo.length ? b : a));

  return h("div", { class: "chart-wrap" },
    h("div", { class: "chart-head" },
      h("div", { class: "legend" },
        h("span", {}, h("span", { class: "swatch todo" }), "À faire"),
        h("span", {}, h("span", { class: "swatch done" }), "Fait"),
      ),
      totalTodo
        ? h("span", { class: "muted small" }, `${totalTodo} à faire · jour le plus chargé : ${busiest.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}`)
        : h("span", { class: "muted small" }, "Tout est fait sur la période"),
    ),
    area,
    h("details", { class: "chart-table" },
      h("summary", {}, "Voir les données"),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Jour"), h("th", {}, "À faire"), h("th", {}, "Fait"))),
        h("tbody", {}, buckets.map((b) => h("tr", {}, h("td", {}, dayLabel(b.date)), h("td", {}, String(b.todo.length)), h("td", {}, String(b.done.length))))),
      ),
    ),
  );
}
