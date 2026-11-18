// Plugins and widgets from GitHub: repositories with the topic
// "repronote-plugin" (manifest repronote-plugin.json, opens as a page in
// Plugins) or "repronote-widget" (manifest repronote-widget.json, a card on
// the home screen). Installing pins the code at the current commit (updating
// is an explicit click) and keeps it on the local server; it then runs in a
// sandbox (sandbox.js) with only the data it asked for.
import { h, emptyState, formatAgo } from "../lib.js";
import { store, pluginData, savePluginData, saveLayout, downloadFile, data as currentData } from "../state.js";
import { PERMISSIONS, createSandbox, grantedData } from "./sandbox.js";

export const KINDS = {
  plugin: {
    topic: "repronote-plugin", manifest: "repronote-plugin.json", index: "github-plugins", prefix: "gh-",
    route: "#/plugins/_github", one: "plugin", many: "plugins",
    title: "Plugins de la communauté", where: "une page dans Plugins",
  },
  widget: {
    topic: "repronote-widget", manifest: "repronote-widget.json", index: "github-widgets", prefix: "ghw-",
    route: "#/plugins/_github-widgets", one: "widget", many: "widgets",
    title: "Widgets de la communauté", where: "une carte sur l'accueil",
  },
};
export const TOPIC = KINDS.plugin.topic;

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const MAX_CODE = 500_000;
const DEFAULT_ICON = "M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5";

// ---- Installed ----

export const installedList = (kind = "plugin") =>
  (pluginData(KINDS[kind].index)?.list ?? []).filter((p) => p && new RegExp(`^${KINDS[kind].prefix}[a-z0-9-]+$`).test(p.id));

/** Installed plugins as entries of the Plugins page. */
export function installedPlugins() {
  return installedList("plugin").map((meta) => ({
    id: meta.id,
    title: meta.name,
    description: meta.description || meta.repo,
    icon: meta.icon || DEFAULT_ICON,
    github: meta,
    render: () => sandboxFor(meta, meta.id).page,
  }));
}

/** Installed widgets as home widget types ("gh:<id>"). Each card on the home screen gets its own frame. */
export function installedWidgetTypes() {
  return installedList("widget").map((meta) => ({
    type: `gh:${meta.id}`,
    title: meta.name,
    description: `${meta.description || ""} (GitHub : ${meta.repo})`.trim(),
    needs: [],
    defaults: {},
    settings: [],
    github: meta,
    render: (_data, _settings, ctx) => sandboxFor(meta, `${meta.id}:${ctx?.id ?? "x"}`).box.frame,
  }));
}

/** FNV-1a: a short, stable hash so different repositories never share an id. */
const hash = (text) => {
  let h = 0x811c9dc5;
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(36).padStart(7, "0").slice(-7);
};
// "a/b-c" and "a-b/c" (or two long names cut short) would give the same readable
// part, and share the stored code and storage: the hash keeps them apart.
const slug = (kind, repo) => {
  const base = repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28).replace(/-$/, "");
  return `${KINDS[kind].prefix}${base}-${hash(repo.toLowerCase())}`;
};

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, referrerPolicy: "no-referrer", credentials: "omit" });
  if (r.status === 403 || r.status === 429) throw new Error("GitHub limite le nombre de recherches : réessayez dans une minute.");
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}.`);
  return r.json();
}

/** "owner/repo" from what the user typed (URL or short form). */
export function parseRepo(text) {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(String(text).trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function validManifest(m, file) {
  if (!m || typeof m !== "object") throw new Error(`${file} est illisible.`);
  if (typeof m.name !== "string" || !m.name.trim()) throw new Error("Le manifeste n'a pas de nom (« name »).");
  const entry = typeof m.entry === "string" ? m.entry.replace(/^\.?\//, "") : "plugin.js";
  if (!/^[\w./-]+\.js$/.test(entry) || entry.includes("..")) throw new Error("« entry » doit être un fichier .js du dépôt.");
  const permissions = Array.isArray(m.permissions) ? m.permissions : [];
  const unknown = permissions.filter((p) => !PERMISSIONS[p]);
  if (unknown.length) throw new Error(`Permissions inconnues : ${unknown.join(", ")}.`);
  const icon = typeof m.icon === "string" && /^[MLHVCSQTAZmlhvcsqtaz0-9 .,-]{1,600}$/.test(m.icon) ? m.icon : null;
  return { name: m.name.trim().slice(0, 60), description: String(m.description ?? "").slice(0, 200), version: String(m.version ?? "").slice(0, 20), entry, permissions: [...new Set(permissions)], icon };
}

/** Manifest + code of a repository at its latest commit (nothing is installed yet). */
export async function fetchFromGitHub(kind, repo) {
  const k = KINDS[kind];
  const info = await getJSON(`${API}/repos/${repo}`);
  const commit = await getJSON(`${API}/repos/${repo}/commits/${encodeURIComponent(info.default_branch)}`);
  const sha = commit.sha;
  const raw = (path) => fetch(`${RAW}/${repo}/${sha}/${path}`, { referrerPolicy: "no-referrer", credentials: "omit" });
  const mr = await raw(k.manifest);
  if (!mr.ok) throw new Error(`Ce dépôt n'a pas de fichier ${k.manifest} à sa racine.`);
  const manifest = validManifest(await mr.json().catch(() => null), k.manifest);
  const cr = await raw(manifest.entry);
  if (!cr.ok) throw new Error(`Fichier introuvable : ${manifest.entry}.`);
  const code = await cr.text();
  if (code.length > MAX_CODE) throw new Error("Trop gros (500 ko max).");
  return { kind, repo: info.full_name, url: info.html_url, owner: info.owner?.login ?? "", stars: info.stargazers_count ?? 0, topics: info.topics ?? [], sha, manifest, code };
}

export function install(p, kind = p.kind ?? "plugin") {
  const k = KINDS[kind];
  // An update keeps the id it was installed with (ids made before the hash existed too).
  const same = installedList(kind).find((x) => x.repo.toLowerCase() === p.repo.toLowerCase());
  const id = same?.id ?? slug(kind, p.repo);
  const meta = { id, repo: p.repo, url: p.url, sha: p.sha, installedAt: Date.now(), ...p.manifest };
  const previous = pluginData(id);
  savePluginData(id, { code: p.code, storage: previous?.storage ?? null });
  savePluginData(k.index, { list: [...installedList(kind).filter((x) => x.id !== id), meta] });
  dropSandboxes(id);
  return id;
}

export function uninstall(id, kind = "plugin") {
  savePluginData(KINDS[kind].index, { list: installedList(kind).filter((x) => x.id !== id) });
  savePluginData(id, null);
  dropSandboxes(id);
  if (kind === "widget" && store.state?.layout?.widgets) {
    saveLayout({ ...store.state.layout, widgets: store.state.layout.widgets.filter((w) => w.type !== `gh:${id}`) });
  }
}

/** A newly installed widget goes on the home screen right away. */
function addToHome(id) {
  import("../widgets/index.js").then(({ defaultLayout }) => {
    const current = store.state?.layout?.widgets ?? defaultLayout().widgets;
    saveLayout({ ...(store.state?.layout ?? {}), widgets: [{ id: `${id}-${Date.now().toString(36)}`, type: `gh:${id}`, col: 0 }, ...current] });
    location.hash = "#/home";
  });
}

// ---- Running (one sandbox per plugin page / per widget card) ----

const sandboxes = new Map(); // key -> { box, page, sha }

function dropSandboxes(id) {
  for (const [key, entry] of sandboxes) {
    if (key === id || key.startsWith(`${id}:`)) {
      entry.box.destroy();
      sandboxes.delete(key);
    }
  }
}

function sandboxFor(meta, key) {
  let entry = sandboxes.get(key);
  if (!entry || entry.sha !== meta.sha) {
    entry?.box.destroy();
    const plugin = { ...meta, code: pluginData(meta.id)?.code ?? "" };
    const box = createSandbox(plugin, {
      getData: () => grantedData(plugin, currentData()),
      getStorage: () => pluginData(meta.id)?.storage ?? null,
      onStorage: (value) => savePluginData(meta.id, { ...(pluginData(meta.id) ?? {}), storage: value }),
      onDownload: (name, type, content) => downloadFile(name, type, content).catch(() => {}),
    });
    entry = { box, sha: meta.sha, page: h("div", { class: "plugin-sandbox" }, box.frame) };
    sandboxes.set(key, entry);
  }
  entry.box.update();
  return entry;
}

// ---- The GitHub page: search, install ----

const ui = { plugin: { results: null, searching: false, error: "" }, widget: { results: null, searching: false, error: "" } };
let pending = null; // fetched, waiting for the user's confirmation
let typed = "";

async function search(kind, rerender) {
  const s = ui[kind];
  s.searching = true;
  s.error = "";
  rerender();
  try {
    const r = await getJSON(`${API}/search/repositories?q=topic:${KINDS[kind].topic}&sort=stars&order=desc&per_page=50`);
    s.results = r.items ?? [];
  } catch (err) {
    s.error = err.message || "Recherche impossible (hors ligne ?).";
  } finally {
    s.searching = false;
    rerender();
  }
}

export async function prepare(kind, repo, rerender) {
  ui[kind].error = "";
  pending = { kind, repo, loading: true };
  rerender();
  try {
    pending = await fetchFromGitHub(kind, repo);
  } catch (err) {
    pending = null;
    ui[kind].error = `${repo} : ${err.message || "impossible de lire ce dépôt."}`;
  }
  rerender();
}

function confirmPanel(kind, rerender) {
  if (!pending || pending.kind !== kind) return null;
  const k = KINDS[kind];
  if (pending.loading) return h("section", { class: "card wide gh-confirm" }, h("p", {}, `Lecture de ${pending.repo}…`));
  const m = pending.manifest;
  const tagged = pending.topics.includes(k.topic);
  return h("section", { class: "card wide gh-confirm", role: "dialog", "aria-label": `Installer ${m.name}` },
    h("h2", {}, `Installer le ${k.one} « ${m.name} » ?`),
    h("p", { class: "muted small" }, `${pending.repo}${m.version ? ` · v${m.version}` : ""} · par ${pending.owner} · ★ ${pending.stars} · version ${pending.sha.slice(0, 7)}`),
    m.description ? h("p", {}, m.description) : null,
    h("p", {}, h("strong", {}, `Ce ${k.one} pourra :`)),
    h("ul", { class: "gh-perms" },
      m.permissions.length ? m.permissions.map((p) => h("li", {}, p === "download" ? PERMISSIONS[p].label : `lire ${PERMISSIONS[p].label}`)) : h("li", {}, "rien lire de vos données")),
    h("p", { class: "muted small" },
      "Il tourne dans un bac à sable : sans accès à Internet, à vos identifiants ni au reste de repronote. Son code n'est pas vérifié par repronote : n'installez que ce qui vient de personnes en qui vous avez confiance."),
    tagged ? null : h("p", { class: "error-text small" }, `Ce dépôt n'a pas le sujet « ${k.topic} ».`),
    h("div", { class: "sh-actions" },
      h("button", { type: "button", onclick: () => {
        const p = pending;
        pending = null;
        const id = install(p, kind);
        if (kind === "plugin") location.hash = `#/plugins/${id}`;
        else if ((store.state?.layout?.widgets ?? []).some((w) => w.type === `gh:${id}`)) location.hash = "#/home";
        else addToHome(id);
      } }, "Installer"),
      h("a", { class: "button secondary", href: pending.url, target: "_blank", rel: "noreferrer" }, "Voir le code ↗"),
      h("button", { type: "button", class: "secondary", onclick: () => ((pending = null), rerender()) }, "Annuler")));
}

export function renderStore(kind, rerender) {
  const k = KINDS[kind];
  const s = ui[kind];
  if (s.results === null && !s.searching && !s.error) queueMicrotask(() => search(kind, rerender));
  const installed = new Map(installedList(kind).map((p) => [p.repo.toLowerCase(), p]));
  return [
    h("div", { class: "segmented gh-kinds", role: "tablist" },
      Object.entries(KINDS).map(([id, x]) =>
        h("a", { class: `seg ${id === kind ? "on" : ""}`, href: x.route, role: "tab", "aria-selected": String(id === kind) }, x.many[0].toUpperCase() + x.many.slice(1)))),
    h("section", { class: "card wide" },
      h("h2", {}, k.title),
      h("p", { class: "muted small" },
        `Des ${k.many} publiés sur GitHub avec le sujet « ${k.topic} » (${k.where}). Chacun tourne dans un bac à sable, sans accès à Internet, et ne voit que les données que vous acceptez au moment de l'installer.`),
      h("form", { class: "gh-form", onsubmit: (e) => {
        e.preventDefault();
        const repo = parseRepo(typed);
        if (!repo) {
          s.error = "Adresse GitHub invalide : utilisez « propriétaire/dépôt » ou le lien du dépôt.";
          rerender();
        } else prepare(kind, repo, rerender);
      } },
        h("input", { id: `gh-repo-${kind}`, type: "text", placeholder: "propriétaire/dépôt ou https://github.com/…", "aria-label": "Dépôt GitHub", value: typed, oninput: (e) => (typed = e.target.value) }),
        h("button", { type: "submit", class: "small-btn" }, "Installer depuis cette adresse")),
      s.error ? h("p", { class: "error-text small", role: "alert" }, s.error) : null),
    confirmPanel(kind, rerender),
    h("section", { class: "card wide" },
      h("div", { class: "row" },
        h("h2", {}, "Disponibles"),
        h("button", { type: "button", class: "secondary small-btn", disabled: s.searching, onclick: () => search(kind, rerender) }, s.searching ? "Recherche…" : "Actualiser")),
      s.results === null
        ? h("p", { class: "muted" }, s.searching ? "Recherche sur GitHub…" : "")
        : s.results.length
          ? h("ul", { class: "gh-list" },
              s.results.map((r) => {
                const mine = installed.get(r.full_name.toLowerCase());
                return h("li", { class: "gh-item" },
                  h("div", { class: "gh-main" },
                    h("a", { href: r.html_url, target: "_blank", rel: "noreferrer" }, h("strong", {}, r.full_name)),
                    r.description ? h("span", { class: "muted small" }, r.description) : null,
                    h("span", { class: "muted small" }, `★ ${r.stargazers_count} · mis à jour ${formatAgo(new Date(r.pushed_at).getTime())}`)),
                  h("button", { type: "button", class: `small-btn ${mine ? "secondary" : ""}`, onclick: () => prepare(kind, r.full_name, rerender) },
                    mine ? "Réinstaller / mettre à jour" : "Installer"));
              }))
          : emptyState(`Aucun ${k.one} publié pour l'instant. Créez le vôtre : un dépôt GitHub avec le sujet « ${k.topic} » et un fichier ${k.manifest} (voir le README de repronote).`)),
    installed.size
      ? h("section", { class: "card wide" },
          h("h2", {}, `Installés (${installed.size})`),
          h("ul", { class: "gh-list" },
            [...installed.values()].map((meta) =>
              h("li", { class: "gh-item" },
                h("div", { class: "gh-main" }, h("strong", {}, meta.name), h("span", { class: "muted small" }, `${meta.repo} · ${meta.sha.slice(0, 7)} · installé ${formatAgo(meta.installedAt)}`)),
                h("span", { class: "sh-actions" }, installedActions(meta, rerender, kind, { compact: true }))))))
      : null,
  ];
}

/** Buttons for an installed plugin/widget. */
export function installedActions(meta, rerender, kind = "plugin", { compact = false } = {}) {
  return [
    compact ? null : h("span", { class: "muted small" }, `${meta.repo} · ${meta.sha.slice(0, 7)} · installé ${formatAgo(meta.installedAt)}`),
    h("button", { type: "button", class: "secondary small-btn", onclick: () => {
      location.hash = KINDS[kind].route;
      prepare(kind, meta.repo, rerender);
    } }, "Mettre à jour"),
    h("a", { class: "button secondary small-btn", href: meta.url, target: "_blank", rel: "noreferrer" }, "GitHub ↗"),
    h("button", { type: "button", class: "secondary small-btn danger", onclick: () => {
      if (!confirm(`Désinstaller « ${meta.name} » ? Ses données enregistrées seront effacées.`)) return;
      uninstall(meta.id, kind);
      if (kind === "plugin") location.hash = "#/plugins";
      else rerender();
    } }, "Désinstaller"),
  ];
}
