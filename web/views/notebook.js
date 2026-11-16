import { h, emptyState, fmtNum } from "../lib.js";
import { fileLink } from "../components.js";

const fmtDate = (iso, withTime = false) =>
  new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });

const missed = (a) => {
  if (a.daysMissed) return `${a.daysMissed} jour${a.daysMissed > 1 ? "s" : ""}`;
  const parts = [];
  if (a.hoursMissed) parts.push(`${a.hoursMissed} h`);
  if (a.minutesMissed) parts.push(`${a.minutesMissed} min`);
  return parts.join(" ") || "";
};

const OBS_KIND = { 0: "Défaut de carnet", 1: "Observation", 2: "Encouragement", 3: "Autre" };

const justifiedTag = (item) =>
  item.justified
    ? h("span", { class: "tag" }, "Justifiée")
    : item.shouldParentsJustify
      ? h("span", { class: "tag warn" }, "À justifier")
      : h("span", { class: "tag warn" }, "Non justifiée");

export default {
  id: "carnet",
  title: "Carnet",

  render(data) {
    const nb = data.notebook;
    if (!nb) return emptyState("Pas encore de carnet synchronisé.");

    const absences = [...nb.absences].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    const delays = [...nb.delays].sort((a, b) => new Date(b.date) - new Date(a.date));
    const punishments = [...nb.punishments].sort((a, b) => new Date(b.dateGiven) - new Date(a.dateGiven));
    const observations = [...nb.observations].sort((a, b) => new Date(b.date) - new Date(a.date));
    const measures = nb.precautionaryMeasures ?? [];

    const hours = absences.reduce((n, a) => n + (a.hoursMissed ?? 0) + (a.minutesMissed ?? 0) / 60 + (a.daysMissed ?? 0) * 7, 0);
    const unjustified = absences.filter((a) => !a.justified).length + delays.filter((d) => !d.justified).length;

    const stat = (label, value, sub) =>
      h("div", {}, h("div", { class: "muted small" }, label), h("div", { class: "big" }, String(value)), sub ? h("div", { class: "muted small" }, sub) : null);

    const section = (title, items, render, empty) =>
      h("section", { class: "card wide" }, h("h2", {}, `${title} (${items.length})`), items.length ? h("ul", { class: "list" }, items.map(render)) : emptyState(empty));

    return [
      h("section", { class: "card summary" },
        stat("Absences", absences.length, hours ? `≈ ${fmtNum(hours, 1)} h manquées` : null),
        stat("Retards", delays.length, delays.length ? `${delays.reduce((n, d) => n + (d.minutes ?? 0), 0)} min au total` : null),
        stat("Punitions", punishments.length),
        stat("Observations", observations.length),
        unjustified ? h("p", { class: "note muted small" }, `${unjustified} absence(s) ou retard(s) non justifié(s).`) : null,
      ),

      section("Absences", absences, (a) =>
        h("li", { class: "row" },
          h("div", {},
            h("div", { class: "subject" },
              a.daysMissed > 1 || new Date(a.startDate).toDateString() !== new Date(a.endDate).toDateString()
                ? `Du ${fmtDate(a.startDate)} au ${fmtDate(a.endDate)}`
                : `${fmtDate(a.startDate, true)} – ${new Date(a.endDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`),
            h("div", { class: "muted small" }, [missed(a), a.reason ?? (a.isReasonUnknown ? "Motif inconnu" : null)].filter(Boolean).join(" · ")),
          ),
          justifiedTag(a),
        ), "Aucune absence."),

      section("Retards", delays, (d) =>
        h("li", { class: "row" },
          h("div", {},
            h("div", { class: "subject" }, `${fmtDate(d.date, true)} · ${d.minutes} min`),
            h("div", { class: "muted small" }, d.reason ?? d.justification ?? ""),
          ),
          justifiedTag(d),
        ), "Aucun retard."),

      section("Punitions et sanctions", punishments, (p) =>
        h("li", {},
          h("div", { class: "row" },
            h("div", { class: "subject" }, p.title),
            h("span", { class: "muted small" }, fmtDate(p.dateGiven)),
          ),
          h("div", { class: "muted small" }, [p.giver, p.reasons?.join(", "), p.exclusion ? "exclusion" : null, p.durationMinutes ? `${p.durationMinutes} min` : null].filter(Boolean).join(" · ")),
          p.circumstances ? h("div", { class: "desc" }, p.circumstances) : null,
          p.workToDo ? h("div", { class: "desc" }, `À faire : ${p.workToDo}`) : null,
          [...(p.workToDoDocuments ?? []), ...(p.circumstancesDocuments ?? [])].length
            ? h("div", { class: "files" }, [...p.workToDoDocuments, ...p.circumstancesDocuments].map((f) => fileLink(f)))
            : null,
        ), "Aucune punition."),

      section("Observations et encouragements", observations, (o) =>
        h("li", { class: "row" },
          h("div", {},
            h("div", { class: "subject" }, o.name || OBS_KIND[o.kind] || "Observation"),
            h("div", { class: "muted small" }, [fmtDate(o.date), o.subject?.name, o.reason].filter(Boolean).join(" · ")),
          ),
          h("span", { class: `tag ${o.kind === 2 ? "" : "warn"}` }, OBS_KIND[o.kind] ?? "Observation"),
        ), "Aucune observation."),

      measures.length
        ? section("Mesures conservatoires", measures, (m) =>
            h("li", {}, h("div", { class: "subject" }, m.title), h("div", { class: "muted small" }, `${fmtDate(m.startDate)} → ${fmtDate(m.endDate)} · ${m.decisionMaker ?? ""}`)), "")
        : null,
    ];
  },
};
