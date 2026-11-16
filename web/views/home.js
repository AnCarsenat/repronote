import { widgetTypes, widgetType, defaultLayout } from "../widgets/index.js";
import { h, formatAgo, emptyState } from "../lib.js";
import { store, saveLayout } from "../state.js";
import { openModal } from "../components.js";

// Home screen: widgets in up to 3 columns. Each widget keeps the column you
// put it in; on narrower screens columns merge (3 -> 2 -> 1) in order.
const MAX_COLS = 3;
const openSettings = new Set();
let dragId = null;
let highlightId = null;

const svgIcon = (d, width = 1.8) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
};
const GEAR = "M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4L10.7 6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM13 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z";
const GRIP = "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01";

const visibleCols = () => (window.innerWidth >= 1100 ? 3 : window.innerWidth >= 720 ? 2 : 1);
const newId = (type) => `${type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function layout() {
  const saved = store.state?.layout?.widgets ?? defaultLayout().widgets;
  return {
    widgets: saved
      .filter((w) => widgetType(w.type))
      .map((w, i) => ({ ...w, col: Number.isInteger(w.col) ? Math.min(w.col, MAX_COLS - 1) : i % MAX_COLS })),
  };
}

function update(change) {
  const next = layout();
  change(next.widgets);
  saveLayout(next);
}

const settingsOf = (w) => ({ ...widgetType(w.type).defaults, ...(w.settings ?? {}) });

/** Adds a widget at the end of a column (the shortest one by default) and highlights it. */
function addWidget(type, col) {
  const id = newId(type);
  update((list) => {
    if (col === undefined) {
      const counts = Array.from({ length: visibleCols() }, (_, c) => list.filter((w) => Math.min(w.col, visibleCols() - 1) === c).length);
      col = counts.indexOf(Math.min(...counts));
    }
    list.push({ id, type, col });
  });
  highlightId = id;
  requestAnimationFrame(() => document.getElementById(`w-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  setTimeout(() => (highlightId = null), 2000);
}

function openGallery(col) {
  const onHome = new Set(layout().widgets.map((w) => w.type));
  openModal(col === undefined ? "Ajouter un widget" : "Ajouter un widget dans cette colonne", (close) => [
    h("div", { class: "gallery-grid" },
      widgetTypes.map((t) =>
        h("button", { type: "button", class: "gallery-item", onclick: () => (close(), addWidget(t.type, col)) },
          h("strong", {}, t.title),
          h("span", { class: "muted small" }, t.description),
          onHome.has(t.type) ? h("span", { class: "tag" }, "Déjà sur l'accueil (vous pouvez l'ajouter encore)") : null,
        ),
      ),
    ),
    h("div", { class: "modal-foot" },
      h("button", { type: "button", class: "secondary small-btn", onclick: () => {
        if (confirm("Remettre l'accueil par défaut ?")) {
          openSettings.clear();
          saveLayout(defaultLayout());
          close();
        }
      } }, "Remettre l'accueil par défaut"),
    ),
  ], { wide: true });
}

// ---- Gear panel ----

function settingsPanel(w, rerender) {
  const type = widgetType(w.type);
  const values = settingsOf(w);
  const set = (key, value) =>
    update((list) => {
      const target = list.find((x) => x.id === w.id);
      target.settings = { ...(target.settings ?? {}), [key]: value };
    });

  const field = (f) => {
    const id = `${w.id}-${f.key}`;
    if (f.type === "boolean") {
      return h("label", { class: "field check", for: id },
        h("input", { id, type: "checkbox", checked: Boolean(values[f.key]), onchange: (e) => set(f.key, e.target.checked) }), f.label);
    }
    if (f.type === "select") {
      return h("label", { class: "field", for: id }, h("span", {}, f.label),
        h("select", { id, onchange: (e) => set(f.key, e.target.value) },
          f.options.map((o) => h("option", { value: o.value, selected: o.value === values[f.key] }, o.label))));
    }
    return h("label", { class: "field", for: id }, h("span", {}, f.label),
      h("input", {
        id, type: "number", min: f.min, max: f.max, value: String(values[f.key]),
        onchange: (e) => set(f.key, Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number(e.target.value) || type.defaults[f.key]))),
      }));
  };

  // Move within the column (keyboard/touch alternative to dragging).
  const move = (delta) =>
    update((list) => {
      const same = list.filter((x) => x.col === w.col);
      const pos = same.findIndex((x) => x.id === w.id);
      const swapWith = same[pos + delta];
      if (!swapWith) return;
      const a = list.findIndex((x) => x.id === w.id);
      const b = list.findIndex((x) => x.id === swapWith.id);
      [list[a], list[b]] = [list[b], list[a]];
    });

  return h("div", { class: "widget-settings" },
    type.settings?.length ? type.settings.map(field) : null,
    h("label", { class: "field", for: `${w.id}-size` }, h("span", {}, "Largeur"),
      h("select", { id: `${w.id}-size`, onchange: (e) => update((list) => (list.find((x) => x.id === w.id).size = e.target.value)) },
        h("option", { value: "normal", selected: w.size !== "wide" }, "Une colonne"),
        h("option", { value: "wide", selected: w.size === "wide" }, "Toute la largeur"))),
    h("label", { class: "field", for: `${w.id}-height` }, h("span", {}, "Hauteur"),
      h("select", { id: `${w.id}-height`, onchange: (e) => update((list) => (list.find((x) => x.id === w.id).maxHeight = Number(e.target.value) || null)) },
        [["", "Automatique"], ["260", "Petite (défilement)"], ["420", "Moyenne (défilement)"], ["620", "Grande (défilement)"]].map(([v, label]) =>
          h("option", { value: v, selected: String(w.maxHeight ?? "") === v }, label)))),
    w.size !== "wide" && visibleCols() > 1
      ? h("label", { class: "field", for: `${w.id}-col` }, h("span", {}, "Colonne"),
          h("select", { id: `${w.id}-col`, onchange: (e) => update((list) => (list.find((x) => x.id === w.id).col = Number(e.target.value))) },
            ["Gauche", "Milieu", "Droite"].slice(0, visibleCols()).map((label, c) =>
              h("option", { value: String(c), selected: Math.min(w.col, visibleCols() - 1) === c }, label))))
      : null,
    h("div", { class: "settings-actions" },
      h("button", { type: "button", class: "secondary small-btn", onclick: () => move(-1), "aria-label": "Monter" }, "↑"),
      h("button", { type: "button", class: "secondary small-btn", onclick: () => move(1), "aria-label": "Descendre" }, "↓"),
      h("button", { type: "button", class: "secondary small-btn danger", onclick: () => {
        openSettings.delete(w.id);
        update((list) => list.splice(list.findIndex((x) => x.id === w.id), 1));
      } }, "Retirer"),
      h("button", { type: "button", class: "small-btn", onclick: () => (openSettings.delete(w.id), rerender()) }, "OK"),
    ),
  );
}

// ---- Drag and drop between and within columns ----

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-end").forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-end"));
}

/** Moves the dragged widget next to `targetId` (or to the end of `col`). */
function dropAt(col, targetId, before) {
  const moving = dragId;
  dragId = null;
  if (!moving || moving === targetId) return;
  update((list) => {
    const [item] = list.splice(list.findIndex((x) => x.id === moving), 1);
    item.col = col;
    const target = targetId && list.find((x) => x.id === targetId);
    item.size = target?.size === "wide" ? "wide" : targetId ? "normal" : "normal";
    if (targetId) {
      let to = list.findIndex((x) => x.id === targetId);
      if (!before) to += 1;
      list.splice(to, 0, item);
    } else list.push(item);
  });
}

function widgetCard(w, rerender) {
  const type = widgetType(w.type);
  const settings = settingsOf(w);
  const data = Object.fromEntries(Object.entries(store.state?.data ?? {}).map(([k, v]) => [k, v.data]));
  let body;
  if (type.needs.some((k) => !(k in data))) body = emptyState(store.state ? "Pas encore de données." : "Chargement…");
  else {
    try {
      body = type.render(data, settings);
    } catch (err) {
      console.error(err);
      body = emptyState(`Erreur du widget : ${err.message}`);
    }
  }
  const oldest = Math.min(...type.needs.map((k) => store.state?.data?.[k]?.fetchedAt ?? Infinity));
  const open = openSettings.has(w.id);

  const el = h("section", { class: `card widget ${w.size === "wide" ? "full" : ""} ${open ? "settings-open" : ""} ${highlightId === w.id ? "flash" : ""}`, id: `w-${w.id}` },
    h("div", { class: "widget-head" },
      h("button", { type: "button", class: "icon-btn grip", title: "Glisser pour déplacer", "aria-label": `Déplacer ${type.title}` }, svgIcon(GRIP, 3.2)),
      h("h2", {}, type.title),
      h("button", {
        type: "button", class: `icon-btn gear ${open ? "active" : ""}`, title: "Réglages du widget",
        "aria-label": `Réglages de ${type.title}`, "aria-expanded": String(open),
        onclick: () => (open ? openSettings.delete(w.id) : openSettings.add(w.id), rerender()),
      }, svgIcon(GEAR)),
    ),
    open ? settingsPanel(w, rerender) : null,
    h("div", {
      class: `widget-body ${w.maxHeight ? "scroll" : ""}`,
      style: w.maxHeight ? { "max-height": `${w.maxHeight}px` } : undefined,
    }, body),
    Number.isFinite(oldest) && Date.now() - oldest > 60 * 60_000 ? h("p", { class: "stale" }, `Données ${formatAgo(oldest)}`) : null,
  );

  // Drag by the grip only, so text inside widgets stays selectable.
  el.querySelector(".grip").addEventListener("pointerdown", () => (el.draggable = true));
  el.addEventListener("dragstart", (e) => {
    dragId = w.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", w.id);
    requestAnimationFrame(() => el.classList.add("dragging"));
  });
  el.addEventListener("dragend", () => {
    el.draggable = false;
    el.classList.remove("dragging");
    clearDropMarks();
  });
  el.addEventListener("dragover", (e) => {
    if (!dragId || dragId === w.id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    clearDropMarks();
    el.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const before = el.classList.contains("drop-before");
    clearDropMarks();
    dropAt(w.col, w.id, before);
  });
  return el;
}

export default {
  id: "home",
  title: "Accueil",

  render(_data, rerender) {
    const { widgets } = layout();
    const n = visibleCols();

    // Full-width widgets go in a band above the columns, in their order.
    const wide = widgets.filter((w) => w.size === "wide");
    const columns = Array.from({ length: n }, (_, c) => {
      // Columns beyond what fits are appended to the last visible one.
      const mine = widgets.filter((w) => w.size !== "wide" && Math.min(w.col, n - 1) === c);
      const col = h("div", { class: "home-col" },
        mine.map((w) => widgetCard(w, rerender)),
        h("button", { type: "button", class: "add-here", onclick: () => openGallery(c) }, "+ Ajouter ici"),
      );
      // Dropping on empty space in a column puts the widget at its end.
      col.addEventListener("dragover", (e) => {
        if (!dragId) return;
        e.preventDefault();
        clearDropMarks();
        col.classList.add("drop-end");
      });
      col.addEventListener("dragleave", (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove("drop-end");
      });
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        clearDropMarks();
        dropAt(c, null, false);
      });
      return col;
    });

    return [
      h("div", { class: "view-toolbar" },
        h("button", { type: "button", class: "small-btn", onclick: () => openGallery() }, "+ Ajouter un widget"),
        h("span", { class: "muted small" }, "Glissez ⋮⋮ pour déplacer · ⚙ pour régler"),
      ),
      wide.length ? h("div", { class: "home-wide" }, wide.map((w) => widgetCard(w, rerender))) : null,
      widgets.length ? h("div", { class: "home-cols", style: { "--cols": String(n) } }, columns) : emptyState("Aucun widget. Ajoutez-en un !"),
    ];
  },
};

// Re-render when the number of columns changes.
let lastCols = visibleCols();
window.addEventListener("resize", () => {
  if (visibleCols() !== lastCols) {
    lastCols = visibleCols();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
});
