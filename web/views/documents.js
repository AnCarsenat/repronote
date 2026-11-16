import { h, emptyState } from "../lib.js";

let category = "";

const bulletinLink = (b) =>
  `/api/doc/bulletin?ident=${encodeURIComponent(b.ident)}&n=${encodeURIComponent(b.file)}&period=${encodeURIComponent(b.period ?? "")}&year=${encodeURIComponent(b.year ?? "")}`;
const casierLink = (f) => `/api/doc/casier?id=${encodeURIComponent(f.id)}&n=${encodeURIComponent(f.name)}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");

export default {
  id: "documents",
  title: "Documents",

  render(data, rerender) {
    const docs = data.documents;
    if (!docs) return emptyState("Pas encore de documents synchronisés.");

    // Report cards, most recent school year first.
    const years = new Map();
    for (const b of [...docs.bulletins].sort((a, b) => (b.yearStart ?? 0) - (a.yearStart ?? 0))) {
      if (!years.has(b.year)) years.set(b.year, []);
      years.get(b.year).push(b);
    }

    const categories = [...new Set(docs.files.map((f) => f.category?.name).filter(Boolean))].sort();
    const files = docs.files
      .filter((f) => !category || f.category?.name === category)
      .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));

    return [
      h("section", { class: "card wide" },
        h("h2", {}, `Bulletins (${docs.bulletins.length})`),
        docs.bulletins.length
          ? [...years].map(([year, list]) =>
              h("div", { class: "doc-year" },
                h("p", { class: "day" }, year ?? "Année inconnue"),
                h("ul", { class: "list" },
                  list.map((b) =>
                    h("li", { class: "row" },
                      h("div", {}, h("div", { class: "subject" }, `${b.label} — ${b.period ?? ""}`), h("div", { class: "muted small" }, b.className ?? "")),
                      h("a", { class: "doc-open", href: bulletinLink(b), target: "_blank", rel: "noreferrer" }, "Ouvrir le PDF"),
                    ),
                  ),
                ),
              ),
            )
          : emptyState("Aucun bulletin publié."),
        h("p", { class: "muted small" }, "Le PDF est généré par Pronote à la première ouverture, puis gardé sur cet ordinateur (disponible hors ligne)."),
      ),

      h("section", { class: "card wide" },
        h("div", { class: "row" },
          h("h2", {}, `Casier numérique (${docs.files.length})`),
          categories.length > 1
            ? h("select", { "aria-label": "Catégorie", onchange: (e) => ((category = e.target.value), rerender()) },
                h("option", { value: "" }, "Toutes les catégories"),
                categories.map((c) => h("option", { value: c, selected: c === category }, c)))
            : null,
        ),
        files.length
          ? h("ul", { class: "list" },
              files.map((f) =>
                h("li", { class: "row" },
                  h("div", { class: "doc-main" },
                    h("div", { class: "doc-title" }, f.unread ? h("span", { class: "unread-dot", title: "Non lu" }) : null, f.name),
                    h("div", { class: "muted small" },
                      f.category ? h("span", { class: "dot-subject", style: { "--subject": f.category.color ?? "var(--muted)" } }) : null,
                      [f.category?.name, fmtDate(f.date)].filter(Boolean).join(" · "),
                    ),
                    f.memo ? h("div", { class: "desc" }, f.memo) : null,
                  ),
                  f.kind === 0 && f.url
                    ? h("a", { class: "doc-open", href: f.url, target: "_blank", rel: "noreferrer" }, "Ouvrir le lien")
                    : h("a", { class: "doc-open", href: casierLink(f), target: "_blank", rel: "noreferrer" }, "Ouvrir"),
                ),
              ),
            )
          : emptyState("Aucun document."),
      ),

      docs.generated.length
        ? h("section", { class: "card wide" },
            h("h2", {}, "Documents de l'établissement"),
            h("ul", { class: "list" },
              docs.generated.map((d) =>
                h("li", { class: "row" },
                  h("div", {},
                    h("div", { class: "doc-title" }, d.unread ? h("span", { class: "unread-dot" }) : null, d.name),
                    h("div", { class: "muted small" }, [d.category?.name, d.to ? `disponible jusqu'au ${fmtDate(d.to)}` : null].filter(Boolean).join(" · ")),
                  ),
                  h("span", { class: "muted small" }, "À télécharger depuis Pronote"),
                ),
              ),
            ),
          )
        : null,
    ];
  },
};
