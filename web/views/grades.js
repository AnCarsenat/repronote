import { h, subjectName, gradeText, on20, isNumber, fmtNum, estimateAverage, overallAverage, emptyState, subjectColor } from "../lib.js";
import { store, saveSubjectSettings } from "../state.js";
import { PRESETS, presetFor, applyPreset } from "../coef-presets.js";

let periodId = null;
let editing = false;
let presetId = "bac-terminale";

const MODES = [
  { value: "normal", label: "Normale" },
  { value: "bonus", label: "Bonus (points > 10)" },
  { value: "excluded", label: "Exclue" },
];

function subjectSettings() {
  return { ...(store.state?.subjectSettings ?? {}) };
}

function setSubject(name, change) {
  const all = subjectSettings();
  all[name] = { coef: 1, mode: "normal", ...(all[name] ?? {}), ...change };
  saveSubjectSettings(all);
}

export default {
  id: "notes",
  title: "Notes",

  render(data, rerender) {
    const grades = data.grades;
    if (!grades?.periods?.length) return emptyState("Pas encore de notes synchronisées.");

    // A period from another school year (after a new sync) no longer exists.
    if (!grades.periods.some((p) => p.id === periodId)) periodId = grades.defaultPeriodId ?? grades.periods[0].id;
    grades.byPeriod ??= {};
    const overview = grades.byPeriod[periodId] ?? { grades: [], subjectsAverages: [] };
    const settings = subjectSettings();

    // Group grades by subject, in Pronote's subject order.
    const bySubject = new Map();
    for (const s of overview.subjectsAverages ?? []) bySubject.set(subjectName(s.subject.name), { info: s, grades: [] });
    for (const g of overview.grades ?? []) {
      const key = subjectName(g.subject?.name);
      if (!bySubject.has(key)) bySubject.set(key, { info: null, grades: [] });
      bySubject.get(key).grades.push(g);
    }

    const subjects = [...bySubject].map(([name, { info, grades: list }]) => {
      const estimate = estimateAverage(list);
      const official = isNumber(info?.student) ? info.student.points : null;
      return {
        name,
        info,
        list: list.sort((a, b) => new Date(b.date) - new Date(a.date)),
        official,
        estimate,
        average: official ?? estimate,
        coef: settings[name]?.coef ?? 1,
        mode: settings[name]?.mode ?? "normal",
      };
    });
    const overall = isNumber(overview.overallAverage) ? overview.overallAverage.points : overallAverage(subjects, settings);
    const overallIsOfficial = isNumber(overview.overallAverage);
    const customized = subjects.some((s) => s.coef !== 1 || s.mode !== "normal");

    // Hide periods without any grade (except the one selected).
    const hasGrades = (p) => (grades.byPeriod[p.id]?.grades?.length ?? 0) > 0 || p.id === periodId;
    const toolbar = h("div", { class: "view-toolbar" },
      grades.periods.filter(hasGrades).map((p) =>
        h("button", { type: "button", class: `chip ${p.id === periodId ? "active" : ""}`, onclick: () => ((periodId = p.id), rerender()) }, p.name),
      ),
    );

    const summary = h("section", { class: "card summary" },
      h("div", {},
        h("div", { class: "muted small" }, overallIsOfficial ? "Moyenne générale" : "Moyenne générale (calculée)"),
        h("div", { class: "big" }, overall === null ? "–" : `${overallIsOfficial ? "" : "≈ "}${fmtNum(overall)}`),
      ),
      isNumber(overview.classAverage)
        ? h("div", {}, h("div", { class: "muted small" }, "Classe"), h("div", { class: "big" }, fmtNum(overview.classAverage.points)))
        : null,
      h("div", {}, h("div", { class: "muted small" }, "Notes"), h("div", { class: "big" }, String(overview.grades?.length ?? 0))),
      overallIsOfficial
        ? null
        : h("div", { class: "note" },
            h("p", { class: "muted small" },
              customized
                ? "Calculée avec vos coefficients de matières. Les moyennes par matière viennent de Pronote."
                : "Pronote ne donne ni la moyenne générale ni les coefficients des matières : toutes les matières comptent pour 1. Réglez-les pour une moyenne plus juste."),
            h("button", { type: "button", class: `${editing ? "" : "secondary"} small-btn`, onclick: () => ((editing = !editing), rerender()) },
              editing ? "Terminé" : "Coefficients des matières"),
          ),
    );

    const editor = editing && !overallIsOfficial
      ? h("section", { class: "card coef-editor" },
          h("h2", {}, "Coefficients des matières"),
          h("p", { class: "muted small" }, "Utilisés pour la moyenne générale sur toutes les périodes. « Bonus » : seuls les points au-dessus de 10 comptent, comme une option facultative."),
          h("div", { class: "preset-row" },
            h("label", { for: "preset" }, "Préréglage"),
            h("select", { id: "preset", onchange: (e) => ((presetId = e.target.value), rerender()) },
              PRESETS.map((p) => h("option", { value: p.id, selected: p.id === presetId }, p.label))),
            h("button", { type: "button", class: "small-btn", onclick: () => {
              const preset = PRESETS.find((p) => p.id === presetId);
              // Every subject seen in any period, so other periods are covered too.
              const names = new Set(subjects.map((s) => s.name));
              for (const ov of Object.values(grades.byPeriod)) {
                for (const sa of ov.subjectsAverages ?? []) names.add(subjectName(sa.subject.name));
                for (const g of ov.grades ?? []) names.add(subjectName(g.subject?.name));
              }
              saveSubjectSettings(applyPreset(preset, [...names]));
            } }, "Appliquer"),
          ),
          h("p", { class: "muted small" }, PRESETS.find((p) => p.id === presetId)?.description ?? ""),
          h("table", {},
            h("thead", {}, h("tr", {}, h("th", {}, "Matière"), h("th", {}, "Moyenne"), h("th", {}, "Coef."), h("th", {}, "Prise en compte"), h("th", {}, "Préréglage"))),
            h("tbody", {},
              subjects.map((s) =>
                h("tr", {},
                  h("td", {}, h("span", { class: "dot-subject", style: { "--subject": subjectColor(s.info) } }), s.name),
                  h("td", { class: "num" }, s.average === null ? "–" : fmtNum(s.average)),
                  h("td", {},
                    h("input", {
                      type: "number", min: "0", max: "20", step: "0.5", value: String(s.coef), "aria-label": `Coefficient ${s.name}`,
                      onchange: (e) => setSubject(s.name, { coef: Math.max(0, Number(e.target.value) || 0) }),
                    }),
                  ),
                  h("td", {},
                    h("select", { "aria-label": `Prise en compte ${s.name}`, onchange: (e) => setSubject(s.name, { mode: e.target.value }) },
                      MODES.map((m) => h("option", { value: m.value, selected: m.value === s.mode }, m.label))),
                  ),
                  h("td", { class: "muted small" }, (() => {
                    const p = presetFor(PRESETS.find((x) => x.id === presetId), s.name);
                    return p.reason ? `${p.reason} · ${p.coef}` : "";
                  })()),
                ),
              ),
            ),
          ),
        )
      : null;

    if (!subjects.length) return [toolbar, summary, emptyState("Aucune note sur cette période.")];

    return [
      toolbar,
      summary,
      editor,
      h("div", { class: "grid" },
        subjects.map((s) =>
          h("section", { class: `card subject-card ${s.mode === "excluded" ? "excluded" : ""}`, style: { "--subject": subjectColor(s.info) } },
            h("div", { class: "row subject-head" },
              h("h2", {}, s.name),
              h("div", { class: "big small-big" },
                s.official !== null
                  ? fmtNum(s.official)
                  : s.estimate !== null
                    ? h("span", { title: "Calculée à partir des notes" }, `≈ ${fmtNum(s.estimate)}`)
                    : h("span", { class: "muted" }, "–")),
            ),
            h("p", { class: "muted small" },
              [
                isNumber(s.info?.class_average) ? `Classe ${fmtNum(s.info.class_average.points)}` : null,
                isNumber(s.info?.min) && isNumber(s.info?.max) ? `min ${fmtNum(s.info.min.points)} · max ${fmtNum(s.info.max.points)}` : null,
                !overallIsOfficial && (s.coef !== 1 || s.mode !== "normal")
                  ? s.mode === "excluded" ? "exclue de la moyenne" : `coef. ${fmtNum(s.coef)}${s.mode === "bonus" ? " (bonus)" : ""}`
                  : null,
              ].filter(Boolean).join(" · "),
            ),
            h("ul", { class: "list" },
              s.list.map((g) => {
                const n = on20(g);
                return h("li", { class: "row" },
                  h("div", {},
                    h("div", {}, g.comment || "Note"),
                    h("div", { class: "muted small" },
                      [
                        new Date(g.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
                        g.coefficient !== 1 ? `coef ${fmtNum(g.coefficient)}` : null,
                        isNumber(g.average) ? `classe ${gradeText(g.average)}` : null,
                        g.isBonus ? "bonus" : null,
                        g.isOptional ? "facultative" : null,
                      ].filter(Boolean).join(" · "),
                    ),
                  ),
                  h("div", { class: "grade" },
                    h("span", { class: "grade-value" }, gradeText(g.value), h("span", { class: "muted" }, `/${gradeText(g.outOf)}`)),
                    n !== null && isNumber(g.outOf) && g.outOf.points !== 20 ? h("span", { class: "muted small" }, `${fmtNum(n, 1)}/20`) : null,
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    ];
  },
};
