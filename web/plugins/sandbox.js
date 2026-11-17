// Runs a plugin installed from GitHub (someone else's code) in a sandbox:
// - <iframe sandbox="allow-scripts">: an opaque origin, so no access to the
//   app's page, cookies, storage or local API;
// - a Content-Security-Policy without any network access (no fetch, images,
//   forms or navigation out), so the data it is given can't leave the device;
// - it only receives the data kinds listed in its manifest (approved at install).
// It talks to the app with postMessage, through the small `repronote` API below.

/** Data kinds a plugin can ask for, with the words shown at install. */
export const PERMISSIONS = {
  user: { label: "votre nom, classe et établissement", keys: ["user"] },
  timetable: { label: "l'emploi du temps", keys: ["timetable", "holidays", "schoolYear"] },
  homework: { label: "les devoirs", keys: ["homework"] },
  grades: { label: "les notes", keys: ["grades"] },
  news: { label: "les informations", keys: ["news"] },
  notebook: { label: "le carnet (absences, retards, punitions)", keys: ["notebook"] },
  documents: { label: "la liste des documents", keys: ["documents"] },
  download: { label: "proposer des fichiers à télécharger", keys: [] },
};

const THEME_TOKENS = ["--bg", "--card", "--text", "--muted", "--border", "--accent", "--accent-soft", "--accent-text", "--good", "--bad", "--radius"];

const BOOTSTRAP = `
(() => {
  const handlers = new Set();
  let storage = null;
  const send = (msg) => parent.postMessage(msg, "*");
  window.repronote = {
    data: {},
    permissions: [],
    /** Called with the data when it changes (after a sync). */
    onUpdate(fn) { handlers.add(fn); },
    storage: {
      get: () => storage,
      /** Saves any JSON value (max ~900 kB) on the user's repronote server. */
      set(value) { storage = value; send({ type: "storage", value }); },
    },
    /** Offers a file to the user (needs the "download" permission). */
    download(name, type, content) { send({ type: "download", name: String(name), mime: String(type), content: String(content) }); },
  };
  addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (m.type === "init" || m.type === "update") {
      repronote.data = m.data || {};
      if (m.type === "init") { storage = m.storage ?? null; repronote.permissions = m.permissions || []; }
      for (const fn of handlers) { try { fn(repronote.data); } catch (err) { console.error(err); } }
    }
  });
  // The content's height (not the frame's), so the frame can shrink as well as grow.
  const measure = () => send({ type: "height", value: Math.ceil(document.body.getBoundingClientRect().height) + 2 });
  addEventListener("DOMContentLoaded", () => new ResizeObserver(measure).observe(document.body));
  addEventListener("error", (e) => send({ type: "error", value: String(e.message || e) }));
})();
`;

const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}button{font:inherit;border:1px solid var(--accent);background:var(--accent);color:var(--accent-text);padding:6px 12px;border-radius:8px;cursor:pointer}
button.secondary{background:transparent;color:var(--accent)}input,select,textarea{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:5px 8px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}`;

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** Only the data the plugin is allowed to see. */
export function grantedData(plugin, data) {
  const out = {};
  for (const p of plugin.permissions ?? []) for (const k of PERMISSIONS[p]?.keys ?? []) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

/**
 * The plugin's frame. Built once per plugin and kept across re-renders (moving
 * an iframe reloads it), then fed new data with update().
 */
export function createSandbox(plugin, { getData, getStorage, onStorage, onDownload }) {
  const css = getComputedStyle(document.documentElement);
  const theme = THEME_TOKENS.map((t) => `${t}:${css.getPropertyValue(t).trim() || "initial"}`).join(";");
  const safeCode = String(plugin.code ?? "").replace(/<\/script/gi, "<\\/script");
  const frame = document.createElement("iframe");
  frame.className = "plugin-frame";
  frame.title = plugin.name;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>:root{${theme};color-scheme:${document.documentElement.dataset.theme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" ? "dark" : "light"}}${BASE_CSS}</style></head>
<body><div id="app"></div><script>${BOOTSTRAP}</script><script>${safeCode}</script></body></html>`;

  const post = (msg) => frame.contentWindow?.postMessage(msg, "*");
  let lastSent = null;
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data ?? {};
    if (m.type === "height" && Number.isFinite(m.value)) frame.style.height = `${Math.min(Math.max(m.value, 40), 20000)}px`;
    else if (m.type === "storage") {
      if (JSON.stringify(m.value ?? null).length <= 900_000) onStorage(m.value ?? null);
    } else if (m.type === "download" && plugin.permissions?.includes("download")) {
      onDownload(String(m.name).slice(0, 120), String(m.mime || "text/plain"), String(m.content ?? ""));
    } else if (m.type === "error") console.warn(`[plugin ${plugin.repo}] ${m.value}`);
  };
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", () => {
    lastSent = getData();
    post({ type: "init", data: lastSent, storage: getStorage(), permissions: plugin.permissions ?? [] });
  });

  return {
    frame,
    update() {
      const next = getData();
      if (JSON.stringify(next) === JSON.stringify(lastSent)) return;
      lastSent = next;
      post({ type: "update", data: next });
    },
    destroy() {
      window.removeEventListener("message", onMessage);
      frame.remove();
    },
  };
}
