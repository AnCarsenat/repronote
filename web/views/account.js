import { h, emptyState, formatAgo } from "../lib.js";
import { store } from "../state.js";

let contacts = null; // loaded on demand
let contactsState = "idle"; // idle | loading | error
let contactsQuery = "";
let emailsState = "idle"; // idle | loading | error
let emailsError = "";

export default {
  id: "donnees",
  title: "Mes données",

  render(data, rerender) {
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
        h("div", { class: "row" },
          h("h2", {}, "Annuaire de l'établissement"),
          h("div", { class: "contacts-actions" },
            h("button", {
              type: "button", class: "secondary small-btn", disabled: emailsState === "loading",
              onclick: async () => {
                emailsState = "loading";
                emailsError = "";
                rerender();
                try {
                  const r = await fetch("/api/contacts/emails", { method: "POST" });
                  const body = await r.json();
                  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
                  contacts = body;
                  emailsState = "idle";
                } catch (err) {
                  emailsState = "error";
                  emailsError = err.message;
                }
                rerender();
              },
            }, emailsState === "loading" ? "Connexion au webmail…" : "Rechercher les adresses e-mail"),
            h("a", { class: "button small-btn", href: "/api/contacts.csv", download: "" }, "Exporter (CSV)"),
          ),
        ),
        h("p", { class: "muted small" }, "Toutes les personnes que vous pouvez contacter par la messagerie Pronote : professeurs (avec leurs matières), personnels (avec leur fonction). Pronote ne donne pas les e-mails : « Rechercher les adresses e-mail » ouvre le webmail de l'ENT (connectez-vous dans la fenêtre) et cherche chaque personne de cette liste, une par une, avec l'autocomplétion du webmail."),
        emailsState === "loading" ? h("p", { class: "banner info" }, "Connectez-vous au webmail dans la fenêtre qui s'est ouverte, puis patientez (environ une demi-seconde par personne).") : null,
        emailsState === "error" ? h("p", { class: "error-text" }, `Échec : ${emailsError}`) : null,
        contacts
          ? [
              h("input", {
                type: "search", class: "search contacts-search", placeholder: "Rechercher un nom, une matière…", value: contactsQuery,
                oninput: (e) => {
                  contactsQuery = e.target.value;
                  rerender();
                  requestAnimationFrame(() => {
                    const el = document.querySelector(".contacts-search");
                    el?.focus();
                    el?.setSelectionRange(contactsQuery.length, contactsQuery.length);
                  });
                },
              }),
              h("table", { class: "contacts" },
                h("thead", {}, h("tr", {}, h("th", {}, "Nom"), h("th", {}, "Type"), h("th", {}, "Matières / fonction"), h("th", {}, "E-mail"))),
                h("tbody", {},
                  contacts
                    .filter((c) => !contactsQuery || `${c.name} ${c.subjects} ${c.function} ${c.type}`.toLowerCase().includes(contactsQuery.toLowerCase()))
                    .map((c) => h("tr", {},
                      h("td", {}, c.name, c.principal ? h("span", { class: "tag" }, "prof. principal") : null),
                      h("td", { class: "muted small" }, c.type),
                      h("td", { class: "small" }, c.subjects || c.function || ""),
                      h("td", { class: "small contact-email" },
                        c.email
                          ? h("a", { href: `mailto:${c.email}` }, c.email)
                          : c.emailCandidates?.length
                            ? [h("span", { class: "tag warn" }, "à vérifier"), c.emailCandidates.map((x) => h("div", { class: "muted" }, `${x.name} — `, h("a", { href: `mailto:${x.email}` }, x.email)))]
                            : h("span", { class: "muted" }, "–"))))),
              ),
            ]
          : h("button", {
              type: "button", class: "secondary small-btn", disabled: contactsState === "loading",
              onclick: async () => {
                contactsState = "loading";
                rerender();
                try {
                  const r = await fetch("/api/contacts");
                  if (!r.ok) throw new Error();
                  contacts = await r.json();
                  contactsState = "idle";
                } catch {
                  contactsState = "error";
                }
                rerender();
              },
            }, contactsState === "loading" ? "Chargement…" : contactsState === "error" ? "Échec — réessayer" : "Afficher l'annuaire"),
      ),

      h("section", { class: "card wide" },
        h("h2", {}, "Assistant IA (MCP)"),
        h("p", { class: "muted small" }, "Permet à un assistant IA (Claude, ou tout client MCP) de lire vos devoirs, emploi du temps, notes, informations… et de cocher des devoirs. Il se connecte à repronote sur cet ordinateur ; rien ne passe par un autre serveur que celui de l'assistant."),
        h("div", { class: "detail-grid" },
          h("div", { class: "detail-row" }, h("span", { class: "muted" }, "Adresse MCP"), h("span", { class: "copy-row" }, h("code", {}, `${location.origin}/mcp`), copyBtn(`${location.origin}/mcp`))),
          h("div", { class: "detail-row" }, h("span", { class: "muted" }, "Claude Code"), h("span", { class: "copy-row" }, h("code", {}, `claude mcp add --transport http repronote ${location.origin}/mcp`), copyBtn(`claude mcp add --transport http repronote ${location.origin}/mcp`))),
        ),
        h("p", { class: "muted small" }, "repronote doit être ouvert pendant que l'assistant l'utilise. Outils : get_today, get_timetable, get_homework, set_homework_done, get_grades, get_news, mark_news_read, get_notebook, get_lesson_contents, list_documents, sync_now."),
      ),

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
