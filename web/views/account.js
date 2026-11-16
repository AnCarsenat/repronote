import { h, emptyState, formatAgo } from "../lib.js";
import { store } from "../state.js";

export default {
  id: "donnees",
  title: "Mes données",

  render(data) {
    const a = data.account;
    const row = (label, value) => (value ? h("div", { class: "detail-row" }, h("span", { class: "muted" }, label), h("span", {}, value)) : null);
    const copyBtn = (text) =>
      h("button", { type: "button", class: "secondary small-btn", onclick: async (e) => {
        try {
          await navigator.clipboard.writeText(text);
          e.target.textContent = "Copié ✓";
        } catch {
          e.target.textContent = "Copie impossible";
        }
      } }, "Copier");

    const kinds = Object.entries(store.state?.data ?? {}).filter(([k]) => k !== "syncWarnings");
    const warnings = Object.entries(data.syncWarnings ?? {});

    return [
      a
        ? h("section", { class: "card wide" },
            h("h2", {}, "Informations personnelles"),
            h("div", { class: "detail-grid" },
              row("Nom", a.name),
              row("Classe", a.className),
              row("Établissement", a.establishment),
              row("INE", a.INE),
              row("E-mail", a.email),
              row("Téléphone", a.phone && a.phone !== "+" ? a.phone : null),
              row("Adresse", [...(a.address ?? []), [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ")),
            ),
            h("p", { class: "muted small" }, "Pour modifier ces informations, passez par Pronote ou le secrétariat."),
          )
        : emptyState("Pas encore d'informations personnelles synchronisées."),

      a?.iCalURL
        ? h("section", { class: "card wide" },
            h("h2", {}, "Emploi du temps dans votre agenda"),
            h("p", { class: "muted small" }, "Lien iCal fourni par Pronote : ajoutez-le dans Google Agenda, Thunderbird, l'app Calendrier… Il est personnel, ne le partagez pas."),
            h("div", { class: "copy-row" }, h("code", {}, a.iCalURL), copyBtn(a.iCalURL)),
          )
        : null,

      h("section", { class: "card wide" },
        h("h2", {}, "Données enregistrées sur cet ordinateur"),
        h("p", { class: "muted small" }, `Dernière synchronisation réussie ${formatAgo(store.state?.lastSuccessfulSync)}. Tout est gardé dans le dossier data/ du projet, utilisable hors ligne.`),
        h("table", { class: "kinds" },
          h("tbody", {},
            kinds.map(([k, v]) =>
              h("tr", {}, h("td", {}, k), h("td", { class: "muted small" }, `mis à jour ${formatAgo(v.fetchedAt)}`)),
            ),
          ),
        ),
        warnings.length
          ? h("details", {}, h("summary", {}, `${warnings.length} donnée(s) non récupérée(s) à la dernière synchro`),
              h("ul", {}, warnings.map(([k, msg]) => h("li", { class: "small" }, `${k} : ${msg}`))))
          : null,
        h("p", {}, h("a", { class: "doc-open", href: "/api/export" }, "Exporter toutes mes données (JSON)")),
      ),
    ];
  },
};
