import { h, emptyState, safeHTML } from "../lib.js";
import { fileLink } from "../components.js";

let filter = "all"; // "all" | "unread"
let category = "";
const open = new Set();

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");

export default {
  id: "infos",
  title: "Informations",

  render(data, rerender) {
    const news = data.news;
    if (!news?.items) return emptyState("Pas encore d'informations synchronisées.");

    const items = [...news.items].sort((a, b) => new Date(b.startDate ?? b.creationDate) - new Date(a.startDate ?? a.creationDate));
    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
    const unread = items.filter((i) => !i.read).length;
    const shown = items.filter((i) => (filter === "all" || !i.read) && (!category || i.category === category));

    const chip = (value, label) =>
      h("button", { type: "button", class: `chip ${filter === value ? "active" : ""}`, onclick: () => ((filter = value), rerender()) }, label);

    return [
      h("div", { class: "view-toolbar" },
        chip("all", `Toutes (${items.length})`),
        chip("unread", `Non lues (${unread})`),
        categories.length > 1
          ? h("select", { "aria-label": "Catégorie", onchange: (e) => ((category = e.target.value), rerender()) },
              h("option", { value: "" }, "Toutes les catégories"),
              categories.map((c) => h("option", { value: c, selected: c === category }, c)))
          : null,
      ),
      shown.length
        ? h("div", { class: "card wide" },
            h("ul", { class: "list" },
              shown.map((i) => {
                const isOpen = open.has(i.key);
                return h("li", { class: `news ${i.read ? "" : "unread"}` },
                  h("button", {
                    type: "button",
                    class: "news-head",
                    "aria-expanded": String(isOpen),
                    onclick: () => (isOpen ? open.delete(i.key) : open.add(i.key), rerender()),
                  },
                    h("span", { class: "news-title" }, i.read ? null : h("span", { class: "unread-dot" }), i.title),
                    h("span", { class: "muted small" },
                      [i.category, i.author, fmtDate(i.startDate ?? i.creationDate)].filter(Boolean).join(" · ")),
                    h("span", { class: "tags" },
                      i.is === "survey" ? h("span", { class: "tag" }, "Sondage") : null,
                      i.hasAttachments || i.attachments?.length ? h("span", { class: "tag" }, "📎 Pièce jointe") : null,
                      i.needToAcknowledge && !i.acknowledged ? h("span", { class: "tag warn" }, "Accusé de réception demandé") : null,
                    ),
                  ),
                  isOpen
                    ? h("div", { class: "news-body" },
                        i.content ? safeHTML(i.content) : h("p", { class: "muted small" }, "Texte pas encore récupéré : il le sera à la prochaine connexion."),
                        i.attachments?.length ? h("div", { class: "files" }, i.attachments.map((f) => fileLink(f))) : null,
                        i.is === "survey" && i.questions?.length
                          ? h("ul", {}, i.questions.map((q) => h("li", {}, q.title, q.answered ? h("span", { class: "muted small" }, " (répondu)") : null)))
                          : null,
                      )
                    : null,
                );
              }),
            ),
          )
        : emptyState(filter === "unread" ? "Tout est lu." : "Aucune information."),
    ];
  },
};
