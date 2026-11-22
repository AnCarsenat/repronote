// Update notice (banner) and the "Mises à jour" settings block.
import { h, formatAgo } from "./lib.js";
import { store, checkUpdates, saveUpdateSettings, installUpdate, refresh } from "./state.js";

const DISMISS = "repronote:update-dismissed";
const dismissed = () => {
  try {
    return localStorage.getItem(DISMISS);
  } catch {
    return null;
  }
};

const HOW = {
  android: "Téléchargez l'APK puis ouvrez-le : il s'installe par-dessus l'ancienne version, vos données restent.",
  "desktop-windows": "Téléchargez l'installateur et lancez-le : il remplace l'ancienne version, vos données restent.",
  "desktop-mac": "Téléchargez le .dmg, ouvrez-le et glissez repronote dans Applications pour remplacer l'ancienne version : vos données restent.",
  "desktop-appimage": "Lancez cette commande dans un terminal : elle installe la nouvelle version dans un dossier à vous, et les mises à jour suivantes se feront toutes seules.",
  "desktop-deb": "Téléchargez le paquet .deb et installez-le par-dessus l'ancien.",
  "desktop-linux": "Téléchargez l'archive et remplacez l'ancien dossier.",
  "server-installed": "Lancez cette commande dans un terminal (ou « repronote-server --update ») :",
  server: "Téléchargez le serveur (.zip) et remplacez l'ancien dossier, ou faites « git pull » si vous l'utilisez depuis les sources.",
};

// ---- Installing ----

let installError = "";
const busy = (u) => ["downloading", "installing", "waiting"].includes(u?.install?.state) && u.install.version === u.latest;

/** What the install is doing, in words (null when nothing is going on). */
function installText(u) {
  const i = u?.install;
  if (!i || i.version !== u.latest) return null;
  if (i.state === "downloading") return `Téléchargement de ${i.version}… ${Math.round((i.progress ?? 0) * 100)} %`;
  if (i.state === "installing") return `Installation de ${i.version}… repronote va redémarrer.`;
  if (i.state === "waiting") return u.platform === "android" ? "Confirmez l'installation dans la fenêtre d'Android." : "Redémarrage sur la nouvelle version…";
  if (i.state === "error") return `La mise à jour a échoué : ${i.message}`;
  return null;
}

async function startInstall(rerender) {
  installError = "";
  try {
    await installUpdate();
  } catch {
    installError = "Serveur local injoignable.";
  }
  rerender?.();
}

// While an update installs, refresh often; once the server runs the new
// version, reload the page so the new interface is used too.
const loadedVersion = () => store.state?.version?.current;
let firstVersion = null;
let polling = null;
export function watchUpdate() {
  const v = loadedVersion();
  if (v && !firstVersion) firstVersion = v;
  if (v && firstVersion && v !== firstVersion) location.reload();
  if (busy(store.state?.update) && !polling) {
    polling = setTimeout(async () => {
      polling = null;
      await refresh();
    }, 1500);
  }
}

/** The banner shown at the top when a newer version is out (until dismissed for that version). */
export function updateBanner() {
  const u = store.state?.update;
  watchUpdate();
  if (!u?.newer || !u.latest) return null;
  const doing = installText(u);
  if (busy(u)) return [h("span", {}, doing)];
  if (dismissed() === u.latest) return null;
  const canInstall = !u.autoUnsupported && u.asset;
  return [
    h("span", {}, u.install?.state === "error" ? doing : `repronote ${u.latest} est disponible (vous avez ${u.current}).`),
    h("span", { class: "banner-actions" },
      canInstall
        ? h("button", { type: "button", class: "small-btn", onclick: () => startInstall() }, "Installer")
        // A command to run (Linux): shown with a copy button in Réglages → À propos.
        : u.command ? h("a", { class: "button small-btn", href: "#/settings", onclick: () => (openAbout = true) }, "Mettre à jour")
        : u.url ? h("a", { class: "button small-btn", href: u.url, target: "_blank", rel: "noreferrer" }, "Télécharger") : null,
      h("a", { class: "button secondary small-btn", href: "#/settings", onclick: () => (openAbout = true) }, "Détails"),
      h("button", { type: "button", class: "secondary small-btn", onclick: (e) => {
        try {
          localStorage.setItem(DISMISS, u.latest);
        } catch {}
        e.target.closest(".banner").hidden = true;
      } }, "Plus tard")),
  ];
}

export let openAbout = false;
export const consumeOpenAbout = () => {
  const v = openAbout;
  openAbout = false;
  return v;
};

let checking = false;
let message = "";

/** Réglages → À propos → Mises à jour. */
export function updateSettingsBlock(row, toggle, rerender) {
  const st = store.state;
  const v = st?.version;
  const u = st?.update;
  const s = st?.updateSettings ?? { enabled: true, channel: "stable", auto: true };
  if (!v) return null;
  const set = async (change) => {
    message = "";
    try {
      await saveUpdateSettings({ ...s, ...change });
    } catch {
      message = "Serveur local injoignable.";
    }
    rerender();
  };
  let status = "Pas encore vérifié.";
  if (u?.error) status = `Vérification impossible : ${u.error}`;
  else if (u?.newer) status = `Nouvelle version disponible : ${u.latest}.`;
  else if (u?.latest) status = `À jour (dernière version ${u.channel === "dev" ? "dev" : "stable"} : ${u.latest}).`;

  return h("div", { class: "set-group" },
    h("h3", {}, "Mises à jour"),
    row("Version installée", `${v.platform}${v.channel === "dev" ? " · version de développement" : ""}`, h("strong", {}, v.current)),
    row("Canal", "Stable : les versions publiées. Dev : la version en cours de développement, mise à jour plus souvent, parfois instable.",
      h("div", { class: "segmented", role: "radiogroup", "aria-label": "Canal" },
        [["stable", "Stable"], ["dev", "Dev"]].map(([value, label]) =>
          h("button", { type: "button", class: `seg ${s.channel === value ? "on" : ""}`, "aria-pressed": String(s.channel === value), onclick: () => set({ channel: value }) }, label)))),
    row("Vérifier automatiquement", "Demande à GitHub s'il existe une nouvelle version, au démarrage puis deux fois par jour. Rien n'est envoyé d'autre que la demande.",
      toggle("set-update-check", s.enabled, (on) => set({ enabled: on })), { id: "set-update-check" }),
    row("Installer automatiquement",
      u?.autoUnsupported
        ? `Pas possible ici : ${u.autoUnsupported}`
        : "Quand une version plus récente sort, repronote vous prévient, la télécharge, vérifie qu'elle vient bien de GitHub, l'installe et redémarre. Vos données sont conservées." +
          (v.platform === "android" ? " Android demande une confirmation la première fois." : ""),
      toggle("set-update-install", s.auto !== false && !u?.autoUnsupported, (on) => set({ auto: on }), { disabled: Boolean(u?.autoUnsupported) }), { id: "set-update-install" }),
    h("div", { class: "update-status" },
      h("p", { class: u?.newer ? "good-text" : u?.error ? "error-text" : "set-hint" }, status, u?.checkedAt ? h("span", { class: "set-hint" }, ` · vérifié ${formatAgo(u.checkedAt)}`) : null),
      h("button", { type: "button", class: "secondary small-btn", disabled: checking, onclick: async () => {
        checking = true;
        message = "";
        rerender();
        try {
          await checkUpdates();
        } catch {
          message = "Serveur local injoignable.";
        }
        checking = false;
        rerender();
      } }, checking ? "Vérification…" : "Vérifier maintenant")),
    message ? h("p", { class: "error-text small" }, message) : null,
    u?.newer
      ? h("div", { class: "update-how" },
          installText(u) ? h("p", { class: u.install?.state === "error" ? "error-text" : "good-text", role: "status" }, installText(u)) : null,
          installError ? h("p", { class: "error-text small" }, installError) : null,
          !u.autoUnsupported && u.asset
            ? h("div", { class: "sh-actions" },
                h("button", { type: "button", class: "small-btn", disabled: busy(u), onclick: () => startInstall(rerender) },
                  busy(u) ? "Installation…" : `Installer ${u.latest} maintenant`))
            : h("p", {}, HOW[u.platform] ?? HOW.server),
          u.autoUnsupported && u.command
            ? h("div", { class: "copy-row" }, h("pre", { class: "update-cmd" }, u.command),
                h("button", { type: "button", class: "secondary small-btn", onclick: async (e) => {
                  try {
                    await navigator.clipboard.writeText(u.command);
                    e.target.textContent = "Copié ✓";
                  } catch {
                    e.target.textContent = "Copie impossible";
                  }
                } }, "Copier"))
            : null,
          h("div", { class: "sh-actions" },
            u.url ? h("a", { class: "button secondary small-btn", href: u.url, target: "_blank", rel: "noreferrer" }, "Télécharger le fichier") : null,
            u.page ? h("a", { class: "button secondary small-btn", href: u.page, target: "_blank", rel: "noreferrer" }, "Notes de version ↗") : null),
          u.notes ? h("details", { class: "set-details" }, h("summary", {}, "Nouveautés"), u.notes) : null)
      : null,
  );
}
