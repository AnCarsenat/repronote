import { h, formatAgo } from "./lib.js";
import { store, subscribe, refresh, syncNow, relogin, data } from "./state.js";
import { subscribe as onSettings, orderedViews, isTabHidden, startView } from "./settings.js";
import home from "./views/home.js";
import timetable from "./views/timetable.js";
import homework from "./views/homework.js";
import grades from "./views/grades.js";
import plugins, { currentPlugin } from "./views/plugins.js";
import resources from "./views/resources.js";
import notebook from "./views/notebook.js";
import news from "./views/news.js";
import documents from "./views/documents.js";
import account from "./views/account.js";
import stats from "./views/stats.js";
import settings, { setViews } from "./views/settings.js";
import welcome from "./views/welcome.js";
import "./notifications.js";
import { caretOffset, setCaret } from "./md-editor.js";
import { updateBanner, watchUpdate } from "./updates.js";

const views = [home, timetable, homework, grades, stats, plugins, resources, notebook, news, documents, account, settings];
setViews(() => views);
const $ = (id) => document.getElementById(id);

// Old links: the calculators moved into Plugins.
if (location.hash === "#/simulateurs") history.replaceState(null, "", "#/plugins/calculateurs");

// Hidden tabs still open from their URL; no hash = the chosen start page.
// "#/plugins/<id>" belongs to the Plugins view.
const currentView = () =>
  views.find((v) => location.hash === `#/${v.id}` || location.hash.startsWith(`#/${v.id}/`)) ??
  (location.hash.length > 2 ? home : startView(views));

function renderHeader() {
  const user = store.state?.data?.user?.data;
  $("who").textContent = user?.name ?? "Pronote";
  $("sub").textContent = user ? [user.className, user.establishment].filter(Boolean).join(" · ") : "";

  const view = currentView();
  // Réglages has its own ⚙ button in the top bar.
  renderNav(orderedViews(views).filter((v) => v !== settings && (!isTabHidden(v.id) || v === view)), view);

  const s = store.state;
  const syncBtn = h("button", { type: "button", class: "secondary small-btn", disabled: Boolean(store.busy), onclick: syncNow },
    store.busy === "sync" || s?.syncing ? "Synchronisation…" : "Actualiser");
  $("status").replaceChildren(...[
    h("span", { class: `dot ${s?.lastSync?.ok === false || store.serverDown ? "bad" : "ok"}` }),
    h("span", { class: "muted small" }, `Synchro ${formatAgo(s?.lastSuccessfulSync)}${s?.pending ? ` · ${s.pending} action(s) en attente` : ""}`),
    syncBtn,
    s?.pronoteURL ? h("a", { class: "button secondary small-btn", href: `${s.pronoteURL}/eleve.html`, target: "_blank", rel: "noreferrer", title: "Ouvrir Pronote dans le navigateur" }, "Pronote ↗") : null,
    h("a", { href: "#/settings", class: `icon-btn settings-link ${view === settings ? "active" : ""}`, title: "Réglages", "aria-label": "Réglages" }, "⚙"),
  ].filter(Boolean));
}

// ---- Tabs: as many as fit on one line, the rest in a "Plus" menu ----
let moreOpen = false;

function renderNav(tabs, active) {
  const nav = $("nav");
  const links = tabs.map((v) =>
    h("a", { href: `#/${v.id}`, class: v === active ? "active" : "", "aria-current": v === active ? "page" : false, "data-id": v.id }, v.title));
  const btn = h("button", { type: "button", class: "nav-more-btn", "aria-haspopup": "true", "aria-expanded": String(moreOpen),
    onclick: (e) => {
      e.stopPropagation();
      moreOpen = !moreOpen;
      fitNav();
    } }, "Plus ▾");
  nav.replaceChildren(...links, h("div", { class: "nav-more" }, btn));
  fitNav();
}

/** Hides the tabs that don't fit (never the current one) and lists them under "Plus". */
function fitNav() {
  const nav = $("nav");
  const links = [...nav.querySelectorAll(":scope > a")];
  const more = nav.querySelector(".nav-more");
  if (!more) return;
  for (const a of links) a.classList.remove("nav-overflow");
  more.hidden = false;
  more.querySelector(".nav-menu")?.remove();
  const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
  const widths = links.map((a) => a.getBoundingClientRect().width + gap);
  const total = widths.reduce((x, y) => x + y, 0);
  const available = nav.clientWidth;
  if (total <= available + 1) {
    more.hidden = true;
    moreOpen = false;
    return;
  }
  // Room for "Plus" and the current tab first, then the others in order.
  let room = available - more.getBoundingClientRect().width - gap;
  const activeIndex = links.findIndex((a) => a.classList.contains("active"));
  if (activeIndex >= 0) room -= widths[activeIndex];
  const hidden = [];
  links.forEach((a, i) => {
    if (i === activeIndex) return;
    if (widths[i] <= room) room -= widths[i];
    else {
      room = -Infinity; // keep the order: once one doesn't fit, the rest go too
      a.classList.add("nav-overflow");
      hidden.push(a);
    }
  });
  const btn = more.querySelector(".nav-more-btn");
  btn.setAttribute("aria-expanded", String(moreOpen));
  if (moreOpen) {
    more.append(h("div", { class: "nav-menu", role: "menu" },
      hidden.map((a) => h("a", { href: a.getAttribute("href"), role: "menuitem", onclick: () => (moreOpen = false) }, a.textContent))));
  }
}

new ResizeObserver(() => fitNav()).observe(document.getElementById("nav"));
document.addEventListener("click", (e) => {
  if (moreOpen && !e.target.closest?.(".nav-more")) {
    moreOpen = false;
    fitNav();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && moreOpen) {
    moreOpen = false;
    fitNav();
    document.querySelector(".nav-more-btn")?.focus();
  }
});

function renderBanner() {
  const banner = $("banner");
  const last = store.state?.lastSync;
  const since = formatAgo(store.state?.lastSuccessfulSync);
  let kind = null;
  let content = [];

  if (store.serverDown) {
    kind = "error";
    content = ["Serveur local injoignable. Lancez « npm run serve »."];
  } else if (store.busy === "login") {
    kind = "info";
    content = ["Connexion en cours… Connectez-vous dans la fenêtre qui s'est ouverte."];
  } else if (last && !last.ok && !store.busy) {
    if (last.errorKind === "offline") {
      kind = "warn";
      content = [`Hors ligne. Affichage des données ${since}. Les devoirs cochés seront envoyés au retour de la connexion.`];
    } else if (last.errorKind === "login") {
      kind = "warn";
      content = [
        h("span", {}, `Session ENT expirée (données ${since}). La reconnexion ouvre une fenêtre sur cet ordinateur.`),
        h("button", { type: "button", onclick: relogin }, "Se reconnecter"),
      ];
    } else {
      kind = "error";
      content = [
        h("span", {}, `Erreur de synchronisation (données ${since}).`),
        h("details", {}, h("summary", {}, "Détails"), last.message ?? ""),
      ];
    }
  }
  watchUpdate(); // reloads the page once the server runs a new version
  // Nothing wrong: tell about a new version, if any.
  if (!kind) {
    const update = updateBanner();
    if (update) {
      kind = "info update";
      content = update;
    }
  }

  banner.hidden = !kind;
  banner.className = `banner ${kind ?? ""}`;
  banner.replaceChildren(...content.map((c) => (typeof c === "string" ? h("span", {}, c) : c)));
}

let backgroundRender = false;

function renderView() {
  // First run (no Pronote address yet): the welcome screen instead of the pages.
  const firstRun = store.state && !store.state.pronoteURL && !Object.keys(store.state.data ?? {}).length;
  const view = firstRun ? welcome : currentView();
  const title = view === plugins ? currentPlugin()?.title ?? view.title : view.title;
  document.title = view === home ? "Pronote" : `${title} · Pronote`;
  let nodes;
  try {
    nodes = view.render(data(), renderView);
  } catch (err) {
    console.error(err);
    nodes = h("p", { class: "empty" }, `Erreur d'affichage : ${err.message}`);
  }
  // Keep the scroll position when re-rendering the same view.
  const y = window.scrollY;
  // The background refresh must not eat what is being typed (fields that only
  // save on change would lose the text, and the caret would jump out).
  const a = document.activeElement;
  const typing = backgroundRender && a?.id && $("view").contains(a) &&
    (a.tagName === "TEXTAREA" || a.isContentEditable || (a.tagName === "INPUT" && /^(text|number|search|url|email|tel|password)$/.test(a.type)))
    ? { id: a.id, editable: a.isContentEditable, caret: a.isContentEditable ? caretOffset(a) : null, value: a.value, start: a.selectionStart, end: a.selectionEnd }
    : null;
  backgroundRender = false;
  const list = [nodes].flat(Infinity).filter(Boolean);
  const current = [...$("view").children];
  // Same nodes as on screen (e.g. a plugin's sandboxed frame): leave them, moving
  // them would reload the frame.
  if (list.length !== current.length || list.some((n, i) => n !== current[i])) $("view").replaceChildren(...list);
  if (typing) {
    const el = document.getElementById(typing.id);
    if (el && el !== document.activeElement && typing.editable) {
      // Markdown note: its text was saved as typed; give back focus and caret.
      el.focus({ preventScroll: true });
      setCaret(el, typing.caret);
    } else if (el && el !== document.activeElement) {
      el.value = typing.value;
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(typing.start, typing.end);
      } catch {}
    }
  }
  window.scrollTo(0, y);
}

function render() {
  renderHeader();
  renderBanner();
  renderView();
}

subscribe(render);
onSettings(render);
window.addEventListener("hashchange", () => {
  if (location.hash === "#/simulateurs") history.replaceState(null, "", "#/plugins/calculateurs");
  render();
  window.scrollTo(0, 0);
});

render();
refresh();
// New data from background syncs, and "now" times.
setInterval(() => {
  backgroundRender = true;
  refresh();
}, 60_000);
