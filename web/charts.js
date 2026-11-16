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

// ---- Generic charts for the Statistiques page ----
// Same rules as above: validated series colors (--series-1 = you, --series-2 = class),
// legend for 2 series, hover tooltip, data table, drawn at real pixel width.

/** Wraps a draw(width) => svg function: redraws when the box is resized. */
function responsive(draw, tooltip) {
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
  new ResizeObserver(([e]) => redraw(e.contentRect.width)).observe(area);
  return area;
}

const legendOf = (series) =>
  h("div", { class: "legend" }, series.map((s, i) => h("span", {}, h("span", { class: `swatch s${i + 1}` }), s.name)));

const dataTable = (head, rows) =>
  h("details", { class: "chart-table" }, h("summary", {}, "Voir les données"),
    h("table", {}, h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));

const fr = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString("fr-FR", { maximumFractionDigits: d }) : "–");

/**
 * Line chart over time. series: [{ name, points: [{ x: Date, y: number }] }], y from 0 to yMax.
 * Crosshair + tooltip on the nearest date.
 */
export function lineChart(series, { yMax = 20, height = 220, label = "" } = {}) {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => +p.x)))].sort((a, b) => a - b);
  if (xs.length < 2) return h("p", { class: "empty" }, "Pas assez de notes pour tracer une évolution.");
  const tooltip = h("div", { class: "chart-tip", hidden: true });
  const draw = (W) => {
    const m = { l: 28, r: 10, t: 10, b: 24 };
    const pw = W - m.l - m.r;
    const ph = height - m.t - m.b;
    const x0 = xs[0];
    const x1 = xs.at(-1);
    const x = (t) => m.l + ((t - x0) / (x1 - x0)) * pw;
    const yMin = Math.max(0, Math.floor(Math.min(...series.flatMap((s) => s.points.map((p) => p.y))) - 2));
    const y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin)) * ph;
    const els = [];
    const step = yMax - yMin > 10 ? 4 : 2;
    for (let v = yMin; v <= yMax; v += step) {
      els.push(s("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === yMin ? "axis" : "gridline" }));
      els.push(s("text", { x: m.l - 6, y: y(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, String(v)));
    }
    // Month ticks.
    const months = [];
    for (let d = new Date(new Date(x0).getFullYear(), new Date(x0).getMonth() + 1, 1); +d <= x1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
    const every = Math.ceil(months.length / Math.max(1, Math.floor(pw / 60)));
    months.forEach((d, i) => i % every === 0 && els.push(s("text", { x: x(+d), y: height - 6, class: "tick", "text-anchor": "middle" }, d.toLocaleDateString("fr-FR", { month: "short" }))));
    series.forEach((se, i) => {
      if (!se.points.length) return;
      const d = se.points.map((p, j) => `${j ? "L" : "M"}${x(+p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
      els.push(s("path", { d, class: `line s${i + 1}` }));
      const last = se.points.at(-1);
      els.push(s("circle", { cx: x(+last.x), cy: y(last.y), r: 4, class: `dot s${i + 1}` }));
    });
    const cross = s("line", { y1: m.t, y2: m.t + ph, class: "crosshair", visibility: "hidden" });
    const hit = s("rect", { x: m.l, y: m.t, width: pw, height: ph, class: "hit" });
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const t = x0 + ((e.clientX - r.left - m.l) / pw) * (x1 - x0);
      const nearest = xs.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
      cross.setAttribute("x1", x(nearest));
      cross.setAttribute("x2", x(nearest));
      cross.setAttribute("visibility", "visible");
      tooltip.replaceChildren(
        h("strong", {}, new Date(nearest).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })),
        series.map((se, i) => {
          const p = [...se.points].reverse().find((q) => +q.x <= nearest);
          return h("div", { class: "tip-row" }, h("span", { class: `swatch s${i + 1}` }), `${se.name} : ${p ? fr(p.y) : "–"}`);
        }),
      );
      tooltip.hidden = false;
      tooltip.style.left = `${(x(nearest) / W) * 100}%`;
    });
    hit.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    });
    const svg = s("svg", { viewBox: `0 0 ${W} ${height}`, width: W, height, class: "chart", role: "img", "aria-label": label }, els, cross, hit);
    return svg;
  };
  return h("div", { class: "chart-wrap" },
    series.length > 1 ? legendOf(series) : null,
    responsive(draw, tooltip),
    dataTable(["Date", ...series.map((s) => s.name)], xs.map((t) => [
      new Date(t).toLocaleDateString("fr-FR"),
      ...series.map((se) => fr([...se.points].reverse().find((q) => +q.x <= t)?.y)),
    ])),
  );
}

/**
 * Horizontal bars, one row per label, 1 or 2 series side by side.
 * rows: [{ label, values: [a, b?], color? }]
 */
export function hBarChart(rows, { series = [{ name: "" }], max, format = (v) => fr(v) } = {}) {
  if (!rows.length) return h("p", { class: "empty" }, "Pas de données.");
  const top = max ?? Math.max(...rows.flatMap((r) => r.values.filter(Number.isFinite)));
  const two = series.length > 1;
  const tooltip = h("div", { class: "chart-tip", hidden: true });
  const draw = (W) => {
    const labelW = Math.min(170, W * 0.38);
    const m = { l: labelW + 8, r: 44, t: 4 };
    const barH = 9;
    const rowH = two ? 2 * barH + 2 + 12 : barH + 14;
    const H = m.t + rows.length * rowH + 4;
    const pw = W - m.l - m.r;
    const els = [];
    rows.forEach((r, i) => {
      const y0 = m.t + i * rowH;
      els.push(s("text", { x: labelW, y: y0 + (two ? barH + 1 : barH / 2) + 1, class: "tick row-label", "text-anchor": "end", "dominant-baseline": "middle" },
        r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label));
      r.values.forEach((v, j) => {
        if (!Number.isFinite(v)) return;
        const w = Math.max(2, (v / top) * pw);
        const yy = y0 + j * (barH + 2);
        els.push(s("path", { d: `M${m.l},${yy}H${m.l + w - 4}Q${m.l + w},${yy} ${m.l + w},${yy + 4}V${yy + barH - 4}Q${m.l + w},${yy + barH} ${m.l + w - 4},${yy + barH}H${m.l}Z`, class: `bar s${j + 1}` }));
        if (j === 0) els.push(s("text", { x: m.l + w + 6, y: yy + barH / 2, class: "tick value", "dominant-baseline": "middle" }, format(v)));
      });
      const hit = s("rect", { x: 0, y: y0 - 2, width: W, height: rowH, class: "hit" });
      hit.addEventListener("pointerenter", () => {
        tooltip.replaceChildren(h("strong", {}, r.label),
          series.map((se, j) => h("div", { class: "tip-row" }, h("span", { class: `swatch s${j + 1}` }), `${se.name ? `${se.name} : ` : ""}${format(r.values[j])}`)));
        tooltip.hidden = false;
        tooltip.style.left = "60%";
        tooltip.style.top = `${y0 + rowH}px`;
        hit.classList.add("active");
      });
      hit.addEventListener("pointerleave", () => ((tooltip.hidden = true), (tooltip.style.top = ""), hit.classList.remove("active")));
      els.push(hit);
    });
    return s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart", role: "img" }, els);
  };
  return h("div", { class: "chart-wrap" },
    two ? legendOf(series) : null,
    responsive(draw, tooltip),
    dataTable(["", ...series.map((s) => s.name || "Valeur")], rows.map((r) => [r.label, ...r.values.map((v) => format(v))])),
  );
}

/** Vertical bars over a sequence (e.g. weeks), one series; `highlight` marks one bar label. */
export function vBarChart(bars, { label = "", highlight = null, format = (v) => String(v) } = {}) {
  if (!bars.length) return h("p", { class: "empty" }, "Pas de données.");
  const tooltip = h("div", { class: "chart-tip", hidden: true });
  const draw = (W) => {
    const H = 190;
    const m = { l: 24, r: 6, t: 8, b: 24 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const max = Math.max(3, ...bars.map((b) => b.value));
    const band = pw / bars.length;
    const bw = Math.min(26, band * 0.66);
    const y = (v) => m.t + ph - (v / max) * ph;
    const els = [];
    const step = max > 12 ? 5 : max > 6 ? 2 : 1;
    for (let v = 0; v <= max; v += step) {
      els.push(s("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "gridline" }));
      els.push(s("text", { x: m.l - 6, y: y(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, String(v)));
    }
    const every = Math.ceil(46 / band);
    bars.forEach((b, i) => {
      const cx = m.l + band * i + band / 2;
      if (b.value > 0) els.push(s("path", { d: topRounded(cx - bw / 2, y(b.value), bw, y(0) - y(b.value), 4), class: `bar s1 ${b.future ? "future" : ""}` }));
      if (i % every === 0 || b.label === highlight) els.push(s("text", { x: cx, y: H - 7, class: `tick ${b.label === highlight ? "today" : ""}`, "text-anchor": "middle" }, b.label));
      const hit = s("rect", { x: m.l + band * i, y: m.t, width: band, height: ph, class: "hit" });
      hit.addEventListener("pointerenter", () => {
        tooltip.replaceChildren(h("strong", {}, b.title ?? b.label), h("div", {}, format(b.value)), b.detail ? h("div", { class: "muted" }, b.detail) : null);
        tooltip.hidden = false;
        tooltip.style.left = `${(cx / W) * 100}%`;
        hit.classList.add("active");
      });
      hit.addEventListener("pointerleave", () => ((tooltip.hidden = true), hit.classList.remove("active")));
      els.push(hit);
    });
    return s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart", role: "img", "aria-label": label }, els);
  };
  return h("div", { class: "chart-wrap" }, responsive(draw, tooltip), dataTable(["", "Valeur"], bars.map((b) => [b.title ?? b.label, format(b.value)])));
}
