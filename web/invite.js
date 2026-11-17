// "Inviter des amis": a ready-made message with the download page, sent the
// way the user likes (share sheet, copy, e-mail, SMS, WhatsApp). Optionally
// with the user's timetable share code, so the friend can add them right away.
import { h } from "./lib.js";

export const DOWNLOAD_PAGE = "https://ancarsenat.github.io/repronote/";

let withCode = true;
let status = "";

function message(code) {
  return [
    "Salut ! J'utilise repronote pour Pronote : emploi du temps, notes et devoirs plus lisibles, notifications, et on peut voir quand on est libres en même temps.",
    "C'est gratuit, sans pub, et les données restent sur ton téléphone ou ton ordi (Android, Windows, Linux).",
    `Télécharger : ${DOWNLOAD_PAGE}`,
    code ? `\nPuis ajoute-moi dans Plugins → Emploi du temps partagé avec ce code :\n${code}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * The invite block. `getCode` (optional) returns a promise of the user's
 * timetable share code.
 */
export function inviteBlock(rerender, { getCode = null } = {}) {
  const build = async () => message(getCode && withCode ? await getCode().catch(() => "") : "");
  const go = (makeUrl) => async () => {
    const text = await build();
    location.href = makeUrl(text);
  };
  return h("div", { class: "invite" },
    getCode
      ? h("label", { class: "sh-check" },
          h("input", { type: "checkbox", checked: withCode, onchange: (e) => ((withCode = e.target.checked), rerender()) }),
          "Joindre mon code d'emploi du temps (pour qu'on me voie dans l'emploi du temps partagé)")
      : null,
    h("div", { class: "sh-actions" },
      typeof navigator.share === "function"
        ? h("button", { type: "button", onclick: async () => {
            try {
              await navigator.share({ title: "repronote", text: await build() });
            } catch {}
          } }, "Partager…")
        : null,
      h("button", { type: "button", class: typeof navigator.share === "function" ? "secondary" : "", onclick: async () => {
        const text = await build();
        try {
          await navigator.clipboard.writeText(text);
          status = "Message copié : collez-le où vous voulez.";
        } catch {
          status = text;
        }
        rerender();
      } }, "Copier le message"),
      h("button", { type: "button", class: "secondary", onclick: go((t) => `mailto:?subject=${encodeURIComponent("Essaie repronote pour Pronote")}&body=${encodeURIComponent(t)}`) }, "E-mail"),
      h("button", { type: "button", class: "secondary", onclick: go((t) => `sms:?&body=${encodeURIComponent(t)}`) }, "SMS"),
      h("button", { type: "button", class: "secondary", onclick: go((t) => `https://wa.me/?text=${encodeURIComponent(t)}`) }, "WhatsApp")),
    status ? h("p", { class: "muted small invite-status", role: "status" }, status) : null,
    h("p", { class: "muted small" }, "Page de téléchargement : ", h("a", { href: DOWNLOAD_PAGE, target: "_blank", rel: "noreferrer" }, DOWNLOAD_PAGE)),
  );
}
