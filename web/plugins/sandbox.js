// Runs a plugin installed from GitHub (someone else's code) in a sandbox.
//
// Two layers, so the data a plugin is given can't leave the device:
// - an <iframe sandbox="allow-scripts"> with an opaque origin (no access to the
//   app's page, cookies, storage or local API) and a CSP without network access.
//   Only our own bootstrap script runs in it (nonce); it shows what the plugin
//   renders, after removing anything that could load or navigate somewhere.
// - the plugin's code runs in a Worker inside that frame. A frame can always
//   navigate itself (`location.href = "https://…?" + data`), and CSP can't stop
//   that; a Worker has no `location` to navigate and no DOM, and it inherits the
//   frame's CSP (no fetch, WebSocket, importScripts…).
// The plugin gets only the data kinds listed in its manifest (approved at
// install) and talks to the app through the small `repronote` API below
// (authoring guide: docs/plugins.md).

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

/** Runs in the Worker, before the plugin's code: the `repronote` API. */
const WORKER_PRELUDE = `
(() => {
  const handlers = new Set();
  const actions = new Map();
  let storage = null;
  let ready = false;
  const RAW = Symbol("html");
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const piece = (v) => (v && v[RAW] !== undefined ? v[RAW] : Array.isArray(v) ? v.map(piece).join("") : escape(v));
  const safe = (s) => ({ [RAW]: s, toString: () => s });
  const call = (fn) => { try { fn(self.repronote.data); } catch (err) { report(err); } };
  const report = (err) => postMessage({ type: "error", value: String(err && err.stack || err) });
  self.repronote = {
    data: {},
    permissions: [],
    /** fn(data) now (if the data is there) and after each sync. */
    onUpdate(fn) { handlers.add(fn); if (ready) call(fn); },
    /** Shows this HTML (a string or repronote.html\`…\`) in the plugin's area. */
    render(content) { postMessage({ type: "render", html: content && content[RAW] !== undefined ? content[RAW] : String(content ?? "") }); },
    /** Template tag: values are escaped (arrays joined, nested html\`\` kept). */
    html(strings, ...values) { return safe(strings.reduce((out, s, i) => out + s + (i < values.length ? piece(values[i]) : ""), "")); },
    escape,
    /** fn(event) when an element with data-action="name" is clicked or changed. */
    on(name, fn) { actions.set(String(name), fn); },
    storage: {
      get: () => storage,
      /** Saves any JSON value (max ~900 kB) on the user's repronote server. */
      set(value) { storage = value; postMessage({ type: "storage", value }); },
    },
    /** Offers a text file to the user (needs the "download" permission). */
    download(name, type, content) { postMessage({ type: "download", name: String(name), mime: String(type), content: String(content) }); },
  };
  for (const name of ["document", "window"]) {
    Object.defineProperty(self, name, { get() { throw new Error("Les plugins n'ont pas accès à la page : affichez avec repronote.render() (voir docs/plugins.md)."); } });
  }
  self.addEventListener("error", (e) => report(e.message));
  self.addEventListener("unhandledrejection", (e) => report(e.reason));
  self.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "init" || m.type === "update") {
      self.repronote.data = m.data || {};
      if (m.type === "init") { storage = m.storage ?? null; self.repronote.permissions = m.permissions || []; }
      ready = true;
      for (const fn of handlers) call(fn);
    } else if (m.type === "event") {
      const fn = actions.get(m.event && m.event.action);
      if (fn) { try { fn(m.event); } catch (err) { report(err); } }
    }
  };
})();
`;

/** Runs in the frame (our code only): starts the Worker, shows its HTML, forwards events. */
const FRAME_BOOTSTRAP = `
(() => {
  const host = parent;
  const app = document.getElementById("app");
  const code = JSON.parse(document.getElementById("plugin-code").textContent);
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  const send = (msg) => host.postMessage(msg, "*");

  // What a plugin may show. Anything else is removed: scripts, frames, forms,
  // links (they could navigate this frame), meta refresh, external resources.
  const TAGS = new Set("a div span p br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption thead tbody tfoot tr th td colgroup col strong b em i u s small mark sub sup code pre kbd blockquote q abbr time figure figcaption img picture details summary section article header footer aside nav main button input select option optgroup textarea label fieldset legend progress meter output style svg g path rect circle ellipse line polyline polygon text tspan title desc defs lineargradient radialgradient stop use symbol clippath mask pattern".split(" "));
  const ATTRS = new Set("class id style title alt src width height colspan rowspan span scope value type checked disabled readonly placeholder min max step name selected multiple open for role lang dir hidden tabindex rows cols maxlength size datetime start reversed label low high optimum viewbox fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity fill-opacity fill-rule clip-rule d x y x1 y1 x2 y2 cx cy r rx ry points transform text-anchor dominant-baseline font-size font-weight opacity offset stop-color stop-opacity gradientunits gradienttransform preserveaspectratio xmlns".split(" "));
  function clean(root) {
    for (const el of [...root.querySelectorAll("*")]) {
      if (!el.isConnected && !root.contains(el)) continue;
      if (!TAGS.has(el.localName.toLowerCase())) { el.remove(); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const ok = n.startsWith("data-") || n.startsWith("aria-") || (ATTRS.has(n) && !(n === "src" && !/^data:(image|audio|video)\\//i.test(a.value.trim())));
        if (!ok) el.removeAttribute(a.name);
      }
    }
    return root;
  }
  function render(html) {
    // Keep the field being typed in (value, caret) when the plugin re-renders.
    const active = document.activeElement;
    const keep = active && active.id && app.contains(active) ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    const t = document.createElement("template");
    t.innerHTML = String(html);
    app.replaceChildren(clean(t.content));
    if (keep) {
      const el = document.getElementById(keep.id);
      if (el) {
        if (keep.value !== undefined && "value" in el) el.value = keep.value;
        el.focus();
        try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch {}
      }
    }
  }
  const values = () => {
    const out = {};
    for (const el of app.querySelectorAll("input[name], select[name], textarea[name]")) {
      if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    return out;
  };
  const fire = (type, el) => worker.postMessage({ type: "event", event: {
    type, action: el.dataset.action, dataset: { ...el.dataset },
    value: "value" in el ? el.value : null, checked: "checked" in el ? el.checked : null, values: values(),
  } });
  const field = (el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(button|submit|reset)$/.test(el.type);
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (el && app.contains(el) && !field(el)) fire("click", el);
  });
  for (const type of ["input", "change"]) {
    app.addEventListener(type, (e) => {
      const el = e.target.closest("[data-action]");
      if (el && field(el)) fire(type, el);
    });
  }

  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "render") render(m.html);
    else if (m.type === "storage" || m.type === "download" || m.type === "error") send(m);
  };
  worker.onerror = (e) => send({ type: "error", value: String(e.message || "erreur") });
  addEventListener("message", (e) => {
    if (e.source !== host) return;
    const m = e.data || {};
    if (m.type === "init" || m.type === "update") worker.postMessage(m);
  });
  // The content's height (not the frame's), so the frame can shrink as well as grow.
  new ResizeObserver(() => send({ type: "height", value: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body);
})();
`;

const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}button{font:inherit;border:1px solid var(--accent);background:var(--accent);color:var(--accent-text);padding:6px 12px;border-radius:8px;cursor:pointer}
button.secondary{background:transparent;color:var(--accent)}input,select,textarea{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:5px 8px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}`;

/** Only the data the plugin is allowed to see. */
export function grantedData(plugin, data) {
  const out = {};
  for (const p of plugin.permissions ?? []) for (const k of PERMISSIONS[p]?.keys ?? []) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

/** JSON that can sit inside a <script type="application/json"> without closing it. */
const inertJSON = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

/**
 * The plugin's frame. Built once per plugin and kept across re-renders (moving
 * an iframe reloads it), then fed new data with update().
 */
export function createSandbox(plugin, { getData, getStorage, onStorage, onDownload }) {
  const css = getComputedStyle(document.documentElement);
  const theme = THEME_TOKENS.map((t) => `${t}:${css.getPropertyValue(t).trim() || "initial"}`).join(";");
  const nonce = crypto.randomUUID().replace(/-/g, "");
  // No network at all; only the bootstrap (nonce) runs in the page; the Worker
  // comes from a blob: URL and inherits this policy.
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'`;
  const dark = document.documentElement.dataset.theme === "dark" || (matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light");
  const frame = document.createElement("iframe");
  frame.className = "plugin-frame";
  frame.title = plugin.name;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'");
  frame.srcdoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>:root{${theme};color-scheme:${dark ? "dark" : "light"}}${BASE_CSS}</style></head>
<body><div id="app"></div><script type="application/json" id="plugin-code">${inertJSON(`${WORKER_PRELUDE}\n${String(plugin.code ?? "")}`)}</script><script nonce="${nonce}">${FRAME_BOOTSTRAP}</script></body></html>`;

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
