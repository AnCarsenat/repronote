import { h, emptyState, safeHTML, htmlToText } from "../lib.js";
import { fileLink, pronoteButton } from "../components.js";
import { setNewsRead } from "../state.js";

// Informations: list on the left, reading pane on the right (one at a time on phones).
let filter = "all"; // "all" | "unread"
let category = "";
let query = "";
let selected = null; // news key

const fmtDate = (iso, long = false) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" }) : "";

function readingPane(i, rerender) {
  if (!i) return h("div", { class: "news-empty muted" }, "Choisissez une information à gauche.");
  return h("article", { class: "news-reader" },
    h("button", { type: "button", class: "secondary small-btn news-back", onclick: () => ((selected = null), rerender()) }, "← Retour"),
    h("div", { class: "news-reader-head" },
      h("h2", {}, i.title),
      h("div", { class: "muted small" }, [i.category, i.author, fmtDate(i.startDate ?? i.creationDate, true)].filter(Boolean).join(" · ")),
      h("div", { class: "tags" },
        i.is === "survey" ? h("span", { class: "tag" }, "Sondage") : null,
        i.answered === false ? h("span", { class: "tag warn" }, "Réponse attendue") : null,
      ),
      h("div", { class: "news-actions" },
        h("button", { type: "button", class: "small-btn", onclick: () => setNewsRead([i.key], !i.read) }, i.read ? "Marquer comme non lu" : "Marquer comme lu ✓"),
        pronoteButton(i.is === "survey" ? "Répondre dans Pronote ↗" : undefined),
      ),
    ),
    i.content ? safeHTML(i.content) : h("p", { class: "muted small" }, "Texte pas encore récupéré : il le sera à la prochaine connexion."),
    i.attachments?.length ? h("div", { class: "news-files" }, h("h3", {}, "Pièces jointes"), h("div", { class: "files" }, i.attachments.map((f) => fileLink(f)))) : null,
    i.is === "survey" && i.questions?.length
      ? h("div", {}, h("h3", {}, "Questions"), h("ol", {}, i.questions.map((q) => h("li", {}, q.title || htmlToText(q.html).slice(0, 120), q.answered ? h("span", { class: "muted small" }, " — répondu") : null))))
      : null,
  );
}

export default {
  id: "infos",
  title: "Informations",

  render(data, rerender) {
    const news = data.news;
    if (!news?.items) return emptyState("Pas encore d'informations synchronisées.");

    const items = [...news.items].sort((a, b) => new Date(b.startDate ?? b.creationDate) - new Date(a.startDate ?? a.creationDate));
    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
    const unreadKeys = items.filter((i) => !i.read).map((i) => i.key);
    const q = query.trim().toLowerCase();
    const shown = items.filter((i) =>
      (filter === "all" || !i.read) &&
      (!category || i.category === category) &&
      (!q || `${i.title} ${i.author} ${htmlToText(i.content ?? "")}`.toLowerCase().includes(q)));
    const current = items.find((i) => i.key === selected) ?? null;

    const chip = (value, label) =>
      h("button", { type: "button", class: `chip ${filter === value ? "active" : ""}`, onclick: () => ((filter = value), rerender()) }, label);

    const search = h("input", {
      type: "search", class: "search", placeholder: "Rechercher…", value: query, "aria-label": "Rechercher dans les informations",
      oninput: (e) => {
        query = e.target.value;
        rerender();
        requestAnimationFrame(() => {
          const el = document.querySelector(".news-board .search");
          el?.focus();
          el?.setSelectionRange(query.length, query.length);
        });
      },
    });

    return h("div", { class: `news-board ${current ? "has-selection" : ""}` },
      h("div", { class: "view-toolbar" },
        search,
        chip("all", `Toutes (${items.length})`),
        chip("unread", `Non lues (${unreadKeys.length})`),
        categories.length > 1
          ? h("select", { "aria-label": "Catégorie", onchange: (e) => ((category = e.target.value), rerender()) },
              h("option", { value: "" }, "Toutes les catégories"),
              categories.map((c) => h("option", { value: c, selected: c === category }, c)))
          : null,
        unreadKeys.length ? h("button", { type: "button", class: "secondary small-btn", onclick: () => setNewsRead(unreadKeys, true) }, "Tout marquer comme lu") : null,
        pronoteButton(),
      ),
      h("div", { class: "news-panes" },
        h("ul", { class: "news-list card" },
          shown.length
            ? shown.map((i) =>
                h("li", {},
                  h("button", {
                    type: "button",
                    class: `news-item ${i.read ? "" : "unread"} ${i.key === selected ? "active" : ""}`,
                    onclick: () => ((selected = i.key), rerender(), window.innerWidth < 900 && window.scrollTo(0, 0)),
                  },
                    h("span", { class: "news-item-top" },
                      i.read ? null : h("span", { class: "unread-dot", title: "Non lue" }),
                      h("span", { class: "news-item-title" }, i.title),
                      h("span", { class: "muted small nowrap" }, fmtDate(i.startDate ?? i.creationDate)),
                    ),
                    h("span", { class: "muted small news-item-meta" },
                      [i.category, i.author].filter(Boolean).join(" · "),
                      i.attachments?.length || i.hasAttachments ? " · 📎" : "",
                      i.is === "survey" ? " · sondage" : ""),
                    i.content ? h("span", { class: "news-item-preview" }, htmlToText(i.content).slice(0, 140)) : null,
                  ),
                ),
              )
            : h("li", { class: "empty" }, filter === "unread" ? "Tout est lu. 🎉" : "Aucun résultat."),
        ),
        h("div", { class: "news-pane card" }, readingPane(current, rerender)),
      ),
    );
  },
};
