import { h } from "../lib.js";
import { store, firstLogin } from "../state.js";

// First run (no Pronote address yet): ask for it, then open the login window.
let value = "";
let error = "";

export default {
  id: "welcome",
  title: "Bienvenue",

  render(_data, rerender) {
    const busy = store.busy === "login";
    const submit = async (e) => {
      e.preventDefault();
      const url = value.trim();
      if (!/^https:\/\/[^/]+\/pronote/i.test(url)) {
        error = "L'adresse doit ressembler à https://XXXXXXXX.index-education.net/pronote/";
        return rerender();
      }
      error = "";
      await firstLogin(url);
      if (!store.state?.pronoteURL) error = "La connexion n'a pas abouti. Réessayez.";
      rerender();
    };

    return h("section", { class: "card welcome" },
      h("h2", {}, "Bienvenue dans repronote"),
      h("p", {}, "Une interface pour Pronote qui marche hors ligne. Pour commencer, indiquez l'adresse Pronote de votre établissement."),
      h("ol", { class: "muted small" },
        h("li", {}, "Ouvrez Pronote dans votre navigateur (via l'ENT si besoin)."),
        h("li", {}, "Copiez l'adresse de la page Pronote : elle ressemble à https://0000000a.index-education.net/pronote/…"),
        h("li", {}, "Collez-la ci-dessous. Une fenêtre s'ouvre : connectez-vous comme d'habitude (ENT ou Pronote)."),
      ),
      h("form", { class: "welcome-form", onsubmit: submit },
        h("input", {
          type: "url", class: "search", required: true, placeholder: "https://0000000a.index-education.net/pronote/",
          value, "aria-label": "Adresse Pronote", disabled: busy,
          oninput: (e) => (value = e.target.value),
        }),
        h("button", { type: "submit", disabled: busy }, busy ? "Connexion en cours…" : "Se connecter"),
      ),
      busy ? h("p", { class: "muted small" }, "Connectez-vous dans la fenêtre qui s'est ouverte. Elle se ferme toute seule.") : null,
      error ? h("p", { class: "error-text" }, error) : null,
      h("p", { class: "muted small" }, "Rien n'est envoyé ailleurs : vos données restent sur cet ordinateur. Aucun mot de passe n'est enregistré."),
    );
  },
};
