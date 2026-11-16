import { h, formatAgo } from "./lib.js";
import { store, subscribe, refresh, syncNow, relogin, data } from "./state.js";
import { subscribe as onSettings, orderedViews, isTabHidden, startView } from "./settings.js";
import home from "./views/home.js";
import timetable from "./views/timetable.js";
import homework from "./views/homework.js";
import grades from "./views/grades.js";
import simulators from "./views/simulators.js";
import resources from "./views/resources.js";
import notebook from "./views/notebook.js";
import news from "./views/news.js";
import documents from "./views/documents.js";
import account from "./views/account.js";
import stats from "./views/stats.js";
import settings, { setViews } from "./views/settings.js";
import welcome from "./views/welcome.js";

const views = [home, timetable, homework, grades, stats, simulators, resources, notebook, news, documents, account, settings];
setViews(() => views);
const $ = (id) => document.getElementById(id);

// Hidden tabs still open from their URL; no hash = the chosen start page.
const currentView = () =>
  views.find((v) => location.hash === `#/${v.id}`) ?? (location.hash.length > 2 ? home : startView(views));

function renderHeader() {
  const user = store.state?.data?.user?.data;
  $("who").textContent = user?.name ?? "Pronote";
  $("sub").textContent = user ? [user.className, user.establishment].filter(Boolean).join(" · ") : "";

  const view = currentView();
  $("nav").replaceChildren(
    ...orderedViews(views).filter((v) => !isTabHidden(v.id) || v === view).map((v) =>
      h("a", { href: `#/${v.id}`, class: v === view ? "active" : "", "aria-current": v === view ? "page" : false }, v.title),
    ),
  );

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

  banner.hidden = !kind;
  banner.className = `banner ${kind ?? ""}`;
  banner.replaceChildren(...content.map((c) => (typeof c === "string" ? h("span", {}, c) : c)));
}

function renderView() {
  // First run (no Pronote address yet): the welcome screen instead of the pages.
  const firstRun = store.state && !store.state.pronoteURL && !Object.keys(store.state.data ?? {}).length;
  const view = firstRun ? welcome : currentView();
  document.title = view === home ? "Pronote" : `${view.title} · Pronote`;
  let nodes;
  try {
    nodes = view.render(data(), renderView);
  } catch (err) {
    console.error(err);
    nodes = h("p", { class: "empty" }, `Erreur d'affichage : ${err.message}`);
  }
  // Keep the scroll position when re-rendering the same view.
  const y = window.scrollY;
  $("view").replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
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
  render();
  window.scrollTo(0, 0);
});

render();
refresh();
setInterval(refresh, 60_000); // new data from background syncs, and "now" times
