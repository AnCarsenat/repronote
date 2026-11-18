// Update notice (banner) and the "Mises à jour" settings block.
import { h, formatAgo } from "./lib.js";
import { store, checkUpdates, saveUpdateSettings } from "./state.js";

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
  "desktop-appimage": "Téléchargez la nouvelle AppImage et remplacez l'ancienne (ou relancez la commande d'installation Linux).",
  "desktop-deb": "Téléchargez le paquet .deb et installez-le par-dessus l'ancien.",
  "desktop-linux": "Téléchargez l'archive et remplacez l'ancien dossier.",
  "server-installed": "Lancez cette commande dans un terminal (ou « repronote-server --update ») :",
  server: "Téléchargez le serveur (.zip) et remplacez l'ancien dossier, ou faites « git pull » si vous l'utilisez depuis les sources.",
};

/** The banner shown at the top when a newer version is out (until dismissed for that version). */
export function updateBanner() {
  const u = store.state?.update;
  if (!u?.newer || !u.latest || dismissed() === u.latest) return null;
  return [
    h("span", {}, `repronote ${u.latest} est disponible (vous avez ${u.current}).`),
    h("span", { class: "banner-actions" },
      u.url ? h("a", { class: "button small-btn", href: u.url, target: "_blank", rel: "noreferrer" }, "Télécharger") : null,
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
  const s = st?.updateSettings ?? { enabled: true, channel: "stable" };
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
      toggle("set-update-auto", s.enabled, (on) => set({ enabled: on })), { id: "set-update-auto" }),
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
          h("p", {}, HOW[u.platform] ?? HOW.server),
          u.command ? h("pre", { class: "update-cmd" }, u.command) : null,
          h("div", { class: "sh-actions" },
            u.url ? h("a", { class: "button small-btn", href: u.url, target: "_blank", rel: "noreferrer" }, "Télécharger") : null,
            u.page ? h("a", { class: "button secondary small-btn", href: u.page, target: "_blank", rel: "noreferrer" }, "Notes de version ↗") : null),
          u.notes ? h("details", { class: "set-details" }, h("summary", {}, "Nouveautés"), u.notes) : null)
      : null,
  );
}
