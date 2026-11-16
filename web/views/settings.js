import { h, formatAgo } from "../lib.js";
import { store, syncNow, saveLayout, saveNotifications, testNotifications } from "../state.js";
import { browserNotificationsUsable } from "../notifications.js";
import { defaultLayout } from "../widgets/index.js";
import {
  getSettings, setSetting, resetSettings, clearLocalData, orderedViews, isTabHidden,
  DEFAULT_ACCENT, isHex, accentTokens,
} from "../settings.js";

// Réglages: per-device preferences, grouped in categories. A side menu on
// wide screens, an accordion on phones (same DOM, switched in CSS).

const REPO = "https://github.com/AnCarsenat/repronote";
const ACCENTS = [
  { name: "Indigo", value: DEFAULT_ACCENT },
  { name: "Bleu", value: "#2a78d6" },
  { name: "Sarcelle", value: "#0f8b8d" },
  { name: "Vert", value: "#1f8a4c" },
  { name: "Orange", value: "#d9730d" },
  { name: "Rouge", value: "#d0453a" },
  { name: "Rose", value: "#c2185b" },
  { name: "Violet", value: "#8e44ad" },
];

let open = "appearance"; // open category; null = all closed (phone accordion)
let dragTab = null;

// app.js hands over its views list (avoids a circular import).
let allViews = () => [];
export const setViews = (fn) => (allViews = fn);

// ---- Small building blocks ----

/** A setting line: label + hint on the left, control on the right. */
const row = (label, hint, control, { stack = false, id } = {}) =>
  h("div", { class: `set-row ${stack ? "stack" : ""}` },
    h("div", { class: "set-label" },
      id ? h("label", { for: id }, label) : h("span", {}, label),
      hint ? h("span", { class: "set-hint" }, hint) : null),
    h("div", { class: "set-control" }, control));

/** Radio buttons styled as a segmented control. */
function segmented(name, value, options, onChange) {
  return h("div", { class: "segmented", role: "radiogroup", "aria-label": name },
    options.map((o) => {
      const id = `set-${name}-${o.value}`;
      return h("label", { class: `seg ${o.value === value ? "on" : ""}`, for: id },
        h("input", { type: "radio", id, name: `set-${name}`, value: o.value, checked: o.value === value, onchange: () => onChange(o.value) }),
        o.label);
    }));
}

/** On/off switch (a real checkbox). */
const toggle = (id, checked, onChange, attrs = {}) =>
  h("span", { class: "switch" },
    h("input", { type: "checkbox", role: "switch", id, checked, onchange: (e) => onChange(e.target.checked), ...attrs }),
    h("span", { class: "switch-track", "aria-hidden": "true" }));

const svg = (d) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  return el;
};
const ICONS = {
  appearance: "M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.2-4-7.6-9-7.6zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01",
  tabs: "M4 6h16M4 12h16M4 18h10",
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z",
  data: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  notifications: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  about: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  chevron: "M9 6l6 6-6 6",
};

// ---- Categories ----

function appearance(s) {
  const themes = [
    { value: "auto", label: "Automatique", hint: "Suit le système" },
    { value: "light", label: "Clair" },
    { value: "dark", label: "Sombre" },
  ];
  const custom = isHex(s.accent) && !ACCENTS.some((a) => a.value === s.accent.toLowerCase());
  const accent = isHex(s.accent) ? s.accent.toLowerCase() : DEFAULT_ACCENT;

  return [
    h("div", { class: "set-group" },
      h("h3", {}, "Thème"),
      h("div", { class: "theme-grid", role: "radiogroup", "aria-label": "Thème" },
        themes.map((t) => {
          const id = `set-theme-${t.value}`;
          return h("label", { class: `theme-card ${s.theme === t.value ? "on" : ""}`, for: id },
            h("input", { type: "radio", id, name: "set-theme", checked: s.theme === t.value, onchange: () => setSetting("theme", t.value) }),
            h("span", { class: `theme-thumb ${t.value}`, "aria-hidden": "true" },
              h("span", { class: "th-bar" }), h("span", { class: "th-line" }), h("span", { class: "th-line short" }), h("span", { class: "th-pill" })),
            h("span", { class: "theme-name" }, t.label, t.hint ? h("span", { class: "set-hint" }, t.hint) : null));
        })),
    ),
    h("div", { class: "set-group" },
      h("h3", {}, "Couleur d'accent"),
      h("div", { class: "swatches", role: "radiogroup", "aria-label": "Couleur d'accent" },
        ACCENTS.map((a) => {
          const id = `set-accent-${a.name}`;
          const t = accentTokens(a.value);
          return h("label", { class: `swatch-btn ${accent === a.value && !custom ? "on" : ""}`, for: id, title: a.name,
            style: { "--sw-l": t["--accent-l"], "--sw-d": t["--accent-d"] } },
            h("input", { type: "radio", id, name: "set-accent", checked: accent === a.value && !custom,
              "aria-label": a.name, onchange: () => setSetting("accent", a.value === DEFAULT_ACCENT ? null : a.value) }));
        }),
        h("label", { class: `swatch-btn custom ${custom ? "on" : ""}`, for: "set-accent-custom", title: "Personnalisée" },
          h("input", {
            type: "color", id: "set-accent-custom", value: accent, "aria-label": "Couleur personnalisée",
            // Live preview while dragging, saved when the picker closes.
            oninput: (e) => {
              const t = accentTokens(e.target.value);
              document.documentElement.dataset.accent = "custom";
              for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(k, v);
            },
            onchange: (e) => setSetting("accent", e.target.value),
          })),
      ),
      h("p", { class: "set-hint" }, "La couleur est ajustée automatiquement pour rester lisible en thème clair comme en sombre."),
      h("div", { class: "accent-preview", "aria-hidden": "true" },
        h("button", { type: "button", tabindex: "-1" }, "Bouton"),
        h("button", { type: "button", class: "secondary", tabindex: "-1" }, "Secondaire"),
        h("span", { class: "chip active" }, "Filtre"),
        h("span", { class: "tag" }, "Étiquette"),
        h("a", { href: "#/settings", tabindex: "-1", onclick: (e) => e.preventDefault() }, "Un lien")),
    ),
    h("div", { class: "set-group" },
      h("h3", {}, "Lecture"),
      row("Taille du texte", null, segmented("text", s.textSize, [
        { value: "small", label: "Petite" }, { value: "normal", label: "Normale" }, { value: "large", label: "Grande" },
      ], (v) => setSetting("textSize", v))),
      row("Densité", "Compacte affiche plus d'éléments à l'écran.", segmented("density", s.density, [
        { value: "comfortable", label: "Confortable" }, { value: "compact", label: "Compacte" },
      ], (v) => setSetting("density", v))),
      row("Réduire les animations", "Désactive les transitions et effets de mouvement.",
        toggle("set-motion", s.reduceMotion, (v) => setSetting("reduceMotion", v)), { id: "set-motion" }),
    ),
    h("div", { class: "set-foot" },
      h("button", { type: "button", class: "secondary small-btn", onclick: () => resetSettings(["theme", "accent", "textSize", "density", "reduceMotion"]) },
        "Rétablir l'apparence par défaut")),
  ];
}

function tabs(s) {
  const views = orderedViews(allViews());
  const save = (list) => setSetting("tabOrder", list.map((v) => v.id));
  const move = (i, delta) => {
    const list = [...views];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(list);
  };
  const setHidden = (id, hidden) => {
    const set = new Set(s.hiddenTabs ?? []);
    hidden ? set.add(id) : set.delete(id);
    setSetting("hiddenTabs", [...set]);
  };

  const items = views.map((v, i) => {
    const locked = v.id === "home";
    const hidden = isTabHidden(v.id);
    const li = h("li", { class: `tab-row ${hidden ? "off" : ""}`, "data-id": v.id },
      h("span", { class: "tab-grip", title: "Glisser pour réordonner", "aria-hidden": "true" }, "⋮⋮"),
      h("span", { class: "tab-name" }, v.title,
        locked ? h("span", { class: "set-hint" }, "Toujours visible") : hidden ? h("span", { class: "set-hint" }, "Masqué · reste accessible par son adresse") : null),
      h("span", { class: "tab-actions" },
        h("button", { type: "button", class: "icon-btn", id: `set-up-${v.id}`, disabled: i === 0, "aria-label": `Monter ${v.title}`, onclick: () => move(i, -1) }, "↑"),
        h("button", { type: "button", class: "icon-btn", id: `set-down-${v.id}`, disabled: i === views.length - 1, "aria-label": `Descendre ${v.title}`, onclick: () => move(i, 1) }, "↓"),
        toggle(`set-tab-${v.id}`, !hidden, (on) => setHidden(v.id, !on), { disabled: locked, "aria-label": `Afficher ${v.title}` })),
    );
    // Drag to reorder (mouse). Arrows above work everywhere.
    li.querySelector(".tab-grip").addEventListener("pointerdown", () => (li.draggable = true));
    li.addEventListener("dragstart", (e) => {
      dragTab = v.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", v.id);
      requestAnimationFrame(() => li.classList.add("dragging"));
    });
    li.addEventListener("dragend", () => {
      li.draggable = false;
      li.classList.remove("dragging");
      dragTab = null;
    });
    li.addEventListener("dragover", (e) => {
      if (!dragTab || dragTab === v.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      li.parentElement.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      li.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const before = li.classList.contains("drop-before");
      const moving = dragTab;
      dragTab = null;
      if (!moving || moving === v.id) return;
      const list = views.filter((x) => x.id !== moving);
      let to = list.findIndex((x) => x.id === v.id);
      if (!before) to += 1;
      list.splice(to, 0, views.find((x) => x.id === moving));
      save(list);
    });
    return li;
  });

  const visible = views.filter((v) => !isTabHidden(v.id) && v.id !== "settings");
  const start = visible.some((v) => v.id === s.startPage) ? s.startPage : "home";

  return [
    h("div", { class: "set-group" },
      h("h3", {}, "Barre de navigation"),
      h("p", { class: "set-hint" }, "Masquez les onglets inutiles et rangez-les dans l'ordre qui vous convient. Glissez ⋮⋮ ou utilisez les flèches."),
      h("ul", { class: "tab-list" }, items),
    ),
    h("div", { class: "set-group" },
      h("h3", {}, "Démarrage"),
      row("Page d'ouverture", "Affichée quand vous ouvrez repronote.",
        h("select", { id: "set-start", onchange: (e) => setSetting("startPage", e.target.value) },
          visible.map((v) => h("option", { value: v.id, selected: v.id === start }, v.title))),
        { id: "set-start" }),
    ),
    h("div", { class: "set-foot" },
      h("button", { type: "button", class: "secondary small-btn", onclick: () => resetSettings(["tabOrder", "hiddenTabs", "startPage"]) },
        "Rétablir les onglets par défaut")),
  ];
}

function homeCategory() {
  const count = (store.state?.layout?.widgets ?? defaultLayout().widgets).length;
  return [
    h("div", { class: "set-group" },
      h("h3", {}, "Widgets"),
      h("p", { class: "set-hint" }, "La disposition de l'accueil est enregistrée sur cet ordinateur (serveur local) : elle est la même dans tous vos navigateurs."),
      row("Modifier les widgets", `${count} widget${count > 1 ? "s" : ""} sur l'accueil. Ajoutez, réglez (⚙) et déplacez (⋮⋮) les widgets directement sur l'accueil.`,
        h("a", { class: "btn-link", href: "#/home" }, "Ouvrir l'accueil")),
      row("Disposition par défaut", "Remet les widgets d'origine à leur place. Vos réglages de widgets sont perdus.",
        h("button", { type: "button", class: "secondary small-btn danger", disabled: !store.state, onclick: () => {
          if (confirm("Remettre l'accueil par défaut ?")) saveLayout(defaultLayout());
        } }, "Réinitialiser l'accueil")),
    ),
  ];
}

function dataCategory() {
  const st = store.state;
  const last = st?.lastSync;
  const busy = Boolean(store.busy) || st?.syncing;
  let status = "Serveur local injoignable";
  let kind = "bad";
  if (!store.serverDown && st) {
    if (!last) [status, kind] = ["Jamais synchronisé", "warn"];
    else if (last.ok) [status, kind] = ["Synchronisation réussie", "ok"];
    else [status, kind] = [{ offline: "Hors ligne", login: "Session ENT expirée" }[last.errorKind] ?? "Erreur de synchronisation", "warn"];
  }

  return [
    h("div", { class: "set-group" },
      h("h3", {}, "Synchronisation"),
      h("div", { class: "sync-card" },
        h("span", { class: `dot ${kind === "ok" ? "ok" : "bad"} ${kind}` }),
        h("div", { class: "sync-text" },
          h("strong", {}, status),
          h("span", { class: "set-hint" },
            `Dernière synchro réussie ${formatAgo(st?.lastSuccessfulSync)}`,
            last && !last.ok ? ` · dernier essai ${formatAgo(last.at)}` : "",
            st?.pending ? ` · ${st.pending} action(s) en attente` : "")),
        h("button", { type: "button", class: "small-btn", disabled: busy || store.serverDown, onclick: syncNow },
          busy ? "Synchronisation…" : "Actualiser maintenant")),
      last && !last.ok && last.message ? h("details", { class: "set-details" }, h("summary", {}, "Détails de l'erreur"), last.message) : null,
      h("p", { class: "set-hint" }, "repronote synchronise aussi tout seul en arrière-plan tant que le serveur tourne."),
    ),
    h("div", { class: "set-group" },
      h("h3", {}, "Données"),
      row("Exporter mes données", "Tout ce que repronote a enregistré, dans un fichier JSON.",
        h("a", { class: "btn-link", href: "/api/export", download: "" }, "Télécharger")),
      row("Vider le cache de ce navigateur", "Efface les réglages de cet appareil (thème, onglets…). Les données Pronote, l'accueil et les coefficients restent sur le serveur local.",
        h("button", { type: "button", class: "secondary small-btn danger", onclick: () => {
          if (confirm("Effacer les réglages enregistrés dans ce navigateur ?")) clearLocalData();
        } }, "Vider le cache")),
    ),
  ];
}

function about() {
  return [
    h("div", { class: "about-hero" },
      h("span", { class: "about-logo", "aria-hidden": "true" }, svg("M5 6h14M5 12h14M5 18h8")),
      h("div", {},
        h("strong", { class: "about-name" }, "repronote"),
        h("span", { class: "set-hint" }, "Une interface alternative pour Pronote, hors ligne, sur votre ordinateur."))),
    h("div", { class: "set-group" },
      row("Code source", null, h("a", { href: REPO, target: "_blank", rel: "noreferrer noopener" }, "github.com/AnCarsenat/repronote")),
      row("Licence", "Logiciel libre : vous pouvez l'utiliser, l'étudier, le modifier et le partager.",
        h("a", { href: `${REPO}/blob/main/LICENSE`, target: "_blank", rel: "noreferrer noopener" }, "GPL-3.0 ou ultérieure")),
      row("API locale", "Pour brancher vos propres outils.", h("a", { href: "/api", target: "_blank" }, "Liste des routes (/api)")),
    ),
    h("div", { class: "set-group privacy" },
      h("h3", {}, "Vie privée"),
      h("p", {}, "Vos données restent sur cet ordinateur : elles sont stockées dans le dossier ", h("code", {}, "data/"),
        " et le serveur n'écoute que localement. Aucun mot de passe n'est enregistré et rien n'est envoyé ailleurs qu'à Pronote."),
    ),
    h("p", { class: "set-hint" }, "Projet indépendant, non affilié à Index Éducation."),
  ];
}

// ---- Notifications & webhooks (saved on the server) ----

const KINDS = [
  ["grade", "Nouvelles notes"],
  ["homework", "Nouveaux devoirs"],
  ["news", "Nouvelles informations"],
  ["canceled", "Cours annulés"],
];
let notifyMsg = null; // { kind: "ok" | "bad", text }
let newHook = { url: "", name: "" };
let rerenderSettings = () => {};

function notificationsCategory() {
  const st = store.state;
  if (!st?.notifications) return [h("p", { class: "set-hint" }, "Serveur local injoignable.")];
  const n = st.notifications;
  const save = async (change) => {
    const err = await saveNotifications({ ...n, ...change });
    notifyMsg = err ? { kind: "bad", text: err } : null;
    rerenderSettings();
  };
  const browser = browserNotificationsUsable();
  const permission = typeof Notification !== "undefined" ? Notification.permission : "denied";
  const looksDiscord = (url) => /discord(app)?\.com\/api\/webhooks\//.test(url);

  return [
    h("div", { class: "set-group" },
      h("h3", {}, "Me prévenir pour"),
      KINDS.map(([kind, label]) =>
        row(label, null, toggle(`set-notify-${kind}`, n.kinds[kind], (v) => save({ kinds: { ...n.kinds, [kind]: v } })), { id: `set-notify-${kind}` })),
      h("p", { class: "set-hint" }, "Vérifié à chaque synchronisation (toutes les 30 minutes tant que repronote est ouvert)."),
    ),
    h("div", { class: "set-group" },
      h("h3", {}, "Sur cet appareil"),
      row(st.systemNotifications ? "Notifications du système" : "Notifications du navigateur",
        st.systemNotifications
          ? "Affichées par l'application, même quand sa fenêtre est cachée."
          : "Affichées tant qu'un onglet repronote est ouvert.",
        toggle("set-notify-system", n.system, (v) => save({ system: v })), { id: "set-notify-system" }),
      browser && n.system && permission !== "granted"
        ? row("Autorisation", permission === "denied" ? "Refusée : changez-la dans les réglages du site de votre navigateur." : "Le navigateur doit vous demander la permission.",
            h("button", { type: "button", class: "small-btn", disabled: permission === "denied", onclick: async () => {
              await Notification.requestPermission();
              rerenderSettings();
            } }, "Autoriser"))
        : null,
    ),
    h("div", { class: "set-group" },
      h("h3", {}, "Webhooks"),
      h("p", { class: "set-hint" }, "Envoie chaque nouveauté à une adresse : un salon Discord (Paramètres du salon → Intégrations → Webhooks), ou n'importe quel service qui accepte du JSON (ntfy, Home Assistant, n8n…)."),
      n.webhooks.map((w, i) =>
        h("div", { class: "set-row webhook-row" },
          h("div", { class: "set-label" },
            h("span", {}, w.name || (w.format === "discord" ? "Discord" : new URL(w.url).hostname)),
            h("span", { class: "set-hint webhook-url" }, w.url.replace(/\/[^/]{12,}$/, "/…"))),
          h("div", { class: "set-control" },
            h("select", { "aria-label": "Format", onchange: (e) => save({ webhooks: n.webhooks.map((x, j) => (j === i ? { ...x, format: e.target.value } : x)) }) },
              h("option", { value: "discord", selected: w.format === "discord" }, "Discord"),
              h("option", { value: "json", selected: w.format === "json" }, "JSON")),
            h("button", { type: "button", class: "secondary small-btn danger", onclick: () => save({ webhooks: n.webhooks.filter((_, j) => j !== i) }) }, "Retirer")))),
      h("form", { class: "webhook-add", onsubmit: (e) => {
        e.preventDefault();
        const url = newHook.url.trim();
        if (!url) return;
        save({ webhooks: [...n.webhooks, { id: String(Date.now()), url, name: newHook.name.trim() || undefined, format: looksDiscord(url) ? "discord" : "json" }] });
        newHook = { url: "", name: "" };
      } },
        h("input", { id: "set-hook-url", type: "url", placeholder: "https://discord.com/api/webhooks/…", value: newHook.url, required: true, "aria-label": "Adresse du webhook", oninput: (e) => (newHook.url = e.target.value) }),
        h("input", { id: "set-hook-name", type: "text", placeholder: "Nom (facultatif)", value: newHook.name, "aria-label": "Nom du webhook", oninput: (e) => (newHook.name = e.target.value) }),
        h("button", { type: "submit", class: "small-btn" }, "Ajouter")),
    ),
    h("div", { class: "set-group" },
      row("Essayer", "Envoie une notification de test partout (appareil et webhooks).",
        h("button", { type: "button", class: "secondary small-btn", onclick: async () => {
          try {
            const r = await testNotifications();
            if (browser && n.system && Notification.permission === "granted") new Notification("repronote : test", { body: "Les notifications fonctionnent." });
            notifyMsg = r.ok ? { kind: "ok", text: "Notification de test envoyée." } : { kind: "bad", text: `Échec : ${r.errors.join(" ; ")}` };
          } catch {
            notifyMsg = { kind: "bad", text: "Serveur local injoignable." };
          }
          rerenderSettings();
        } }, "Envoyer un test")),
      notifyMsg ? h("p", { class: notifyMsg.kind === "ok" ? "set-hint" : "error-text", role: "status" }, notifyMsg.text) : null,
    ),
    st.events?.length
      ? h("div", { class: "set-group" },
          h("h3", {}, "Dernières notifications"),
          h("ul", { class: "event-list" },
            st.events.slice(0, 10).map((e) =>
              h("li", {}, h("strong", {}, e.title), h("span", { class: "set-hint" }, `${e.body} · ${formatAgo(e.at)}`)))))
      : null,
  ];
}

const CATEGORIES = [
  { id: "appearance", title: "Apparence", hint: "Thème, couleur, texte", render: appearance },
  { id: "tabs", title: "Onglets", hint: "Navigation, page d'ouverture", render: tabs },
  { id: "home", title: "Accueil", hint: "Widgets", render: homeCategory },
  { id: "notifications", title: "Notifications", hint: "Alertes, webhooks Discord", render: notificationsCategory },
  { id: "data", title: "Synchronisation & données", hint: "Actualiser, exporter, cache", render: dataCategory },
  { id: "about", title: "À propos", hint: "Licence, vie privée", render: about },
];

export default {
  id: "settings",
  title: "Réglages",

  render(_data, rerender) {
    rerenderSettings = rerender;
    const s = getSettings();
    const select = (id) => {
      open = id;
      rerender();
    };
    // Re-rendering replaces the DOM: give focus back to the same control.
    const focused = document.activeElement?.id;
    if (focused) queueMicrotask(() => document.getElementById(focused)?.focus({ preventScroll: true }));

    const shown = open ?? CATEGORIES[0].id;
    return h("div", { class: "settings" },
      h("div", { class: "settings-head" },
        h("h2", {}, "Réglages"),
        h("p", { class: "set-hint" }, "Ces préférences sont propres à ce navigateur.")),
      h("div", { class: "settings-layout" },
        h("nav", { class: "settings-menu", "aria-label": "Catégories de réglages" },
          CATEGORIES.map((c) =>
            h("button", { type: "button", id: `set-menu-${c.id}`, class: `settings-menu-item ${shown === c.id ? "on" : ""}`,
              "aria-current": shown === c.id ? "true" : false, onclick: () => select(c.id) },
              svg(ICONS[c.id === "home" ? "home" : c.id]), h("span", {}, c.title)))),
        h("div", { class: "settings-panels" },
          CATEGORIES.map((c) => {
            const isOpen = open === c.id;
            return h("section", { class: `card set-cat ${isOpen ? "open" : ""} ${shown === c.id ? "shown" : ""}`, "aria-labelledby": `set-title-${c.id}` },
              h("button", { type: "button", class: "set-cat-head", id: `set-acc-${c.id}`, "aria-expanded": String(isOpen),
                onclick: () => select(isOpen ? null : c.id) },
                h("span", { class: "set-cat-icon" }, svg(ICONS[c.id])),
                h("span", { class: "set-cat-titles" }, h("strong", {}, c.title), h("span", { class: "set-hint" }, c.hint)),
                h("span", { class: "set-chevron" }, svg(ICONS.chevron))),
              h("div", { class: "set-body" },
                h("h2", { class: "set-title", id: `set-title-${c.id}` }, c.title),
                c.render(s)));
          })),
      ),
    );
  },
};
