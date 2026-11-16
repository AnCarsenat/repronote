// Exam rules for the "Calculateurs" page — ALL coefficients and thresholds live here.
//
// Checked in November 2026 against the texts listed in SOURCES. When a rule
// changes, update it here; anything that could not be checked is flagged with
// `verified: false` and a note, and the page shows it as « à vérifier ».
//
// Item fields:
//   id          stable key (saved marks are keyed by it, keep it when editing)
//   label       shown in the form
//   coef        official coefficient
//   group       section of the form (see GROUPS)
//   year        "1re" | "Tle": class whose Pronote averages can prefill it
//   match       which Pronote subject prefills it (see views/simulators.js)
//   optional    counted only when a mark is entered (options)
//   bonus       brevet optional course: only the points above 10 count
//   secondGroup can be retaken at the bac second group (rattrapage)
//   note        small hint under the label

export const RULES_CHECKED = "novembre 2026";

export const SOURCES = {
  memento: {
    label: "Eduscol — Mémento « Modalités de l'évaluation en cycle terminal » (sept. 2025)",
    url: "https://eduscol.education.fr/document/67636/download",
  },
  eam: {
    label: "Service-Public — épreuve anticipée de mathématiques, Grand oral 8/12 (juin 2025)",
    url: "https://www.service-public.gouv.fr/particuliers/actualites/A18355",
  },
  jury: {
    label: "Service-Public — décret n° 2025-1159 : rattrapage dès 8/20, points jury ≤ 0,5 (déc. 2025)",
    url: "https://www.service-public.gouv.fr/particuliers/actualites/A18702",
  },
  academie: {
    label: "Académie de Nancy-Metz — dossier bac (mentions, second groupe, épreuve de contrôle)",
    url: "https://ac-nancy-metz.fr/media/29353/download",
  },
  bacProControle: {
    label: "Bulletin officiel n° 4 du 27 janvier 2022 — épreuve de contrôle du bac pro",
    url: "https://www.education.gouv.fr/bo/22/Hebdo4/MENE2139306N.htm",
  },
  dnbArrete: {
    label: "Arrêté du 31 décembre 2015 modifié le 10 avril 2025 (version en vigueur, art. 5 à 10)",
    url: "https://pedagogie.ac-orleans-tours.fr/documents/pdf/dnb_2026_arrete_31-12-2015_version_en_vigueur_au_01-09-2025.pdf",
  },
  dnbSP: {
    label: "Service-Public — brevet 2026 : 40 % contrôle continu, 60 % épreuves, note sur 20",
    url: "https://www.service-public.gouv.fr/particuliers/actualites/A18437",
  },
};

export const GROUPS = {
  cc1: "Contrôle continu — Première (moyennes annuelles)",
  cc2: "Contrôle continu — Terminale (moyennes annuelles)",
  anticipe: "Épreuves anticipées (fin de Première)",
  final: "Épreuves terminales",
  options: "Options (comptent seulement si renseignées)",
  cc: "Contrôle continu (40 %)",
  exam: "Épreuves finales (60 %)",
};

// Bac général / technologique / professionnel and brevet: same thresholds.
export const MENTIONS = [
  { min: 12, label: "Assez bien" },
  { min: 14, label: "Bien" },
  { min: 16, label: "Très bien" },
  { min: 18, label: "Très bien avec félicitations du jury" },
];

// ---- Bac général et technologique ----
// 100 coefficients for compulsory subjects: 40 contrôle continu, 60 épreuves.
// Session 2027: épreuve anticipée de maths (coef 2) taken in June 2026,
// Grand oral 10 -> 8 (général) and 14 -> 12 (techno). Options: +2 per option
// and per year (général: 1 in Première, 2 in Terminale; techno: 2 per year;
// LCA latin/grec on top).

function bacGT(track, session) {
  const general = track === "general";
  const eam = session >= 2027;
  const grandOral = general ? (eam ? 8 : 10) : (eam ? 12 : 14);
  const sciLabel = general ? "Enseignement scientifique" : "Mathématiques";
  const sciMatch = general ? "sci" : "math";
  const items = [
    // Contrôle continu, Première (21)
    { id: "spe-abandon", label: "Spécialité abandonnée en fin de Première", coef: 8, group: "cc1", year: "1re", match: "spe3",
      note: "La spécialité que vous ne gardez pas en Terminale." },
    { id: "hg-1", label: "Histoire-géographie", coef: 3, group: "cc1", year: "1re", match: "hist" },
    { id: "lva-1", label: "Langue vivante A", coef: 3, group: "cc1", year: "1re", match: "lv1" },
    { id: "lvb-1", label: "Langue vivante B", coef: 3, group: "cc1", year: "1re", match: "lv2" },
    { id: "sci-1", label: sciLabel, coef: 3, group: "cc1", year: "1re", match: sciMatch,
      note: general ? "Sans spécialité maths, les « maths spécifiques » comptent pour 40 % de cette moyenne." : null },
    { id: "emc-1", label: "Enseignement moral et civique", coef: 1, group: "cc1", year: "1re", match: "emc" },
    // Contrôle continu, Terminale (19)
    { id: "hg-2", label: "Histoire-géographie", coef: 3, group: "cc2", year: "Tle", match: "hist" },
    { id: "lva-2", label: "Langue vivante A", coef: 3, group: "cc2", year: "Tle", match: "lv1" },
    { id: "lvb-2", label: "Langue vivante B", coef: 3, group: "cc2", year: "Tle", match: "lv2" },
    { id: "sci-2", label: sciLabel, coef: 3, group: "cc2", year: "Tle", match: sciMatch },
    { id: "eps", label: "Éducation physique et sportive", coef: 6, group: "cc2", year: "Tle", match: "eps",
      note: "Note de CCF de Terminale (pas la moyenne annuelle)." },
    { id: "emc-2", label: "Enseignement moral et civique", coef: 1, group: "cc2", year: "Tle", match: "emc" },
    // Épreuves anticipées
    { id: "fr-ecrit", label: "Français — écrit", coef: 5, group: "anticipe", year: "1re", match: "french", secondGroup: true },
    { id: "fr-oral", label: "Français — oral", coef: 5, group: "anticipe", year: "1re", match: "french" },
    eam && { id: "maths-anticipee", label: "Mathématiques (épreuve anticipée)", coef: 2, group: "anticipe", year: "1re", match: "eam",
      note: "Écrit de 2 h sans calculatrice, passé en juin de Première." },
    // Épreuves terminales
    { id: "philo", label: "Philosophie", coef: general ? 8 : 4, group: "final", year: "Tle", match: "philo", secondGroup: true },
    { id: "spe-1", label: "Spécialité 1", coef: 16, group: "final", year: "Tle", match: "spe1", secondGroup: true },
    { id: "spe-2", label: "Spécialité 2", coef: 16, group: "final", year: "Tle", match: "spe2", secondGroup: true },
    { id: "grand-oral", label: "Grand oral", coef: grandOral, group: "final", year: "Tle", match: null },
    // Options: coefficient 2 per option and per year, added to the total.
    { id: "opt-1", label: general ? "Option de Première" : "Option 1 de Première", coef: 2, group: "options", year: "1re", match: "option1", optional: true },
    !general && { id: "opt-1b", label: "Option 2 de Première", coef: 2, group: "options", year: "1re", match: "option2", optional: true },
    { id: "opt-2", label: "Option 1 de Terminale", coef: 2, group: "options", year: "Tle", match: "option1", optional: true,
      note: general ? "Ex. mathématiques complémentaires ou expertes, DGEMC." : null },
    { id: "opt-3", label: "Option 2 de Terminale", coef: 2, group: "options", year: "Tle", match: "option2", optional: true },
    { id: "lca-1", label: "LCA latin ou grec — Première", coef: 2, group: "options", year: "1re", match: "lca", optional: true },
    { id: "lca-2", label: "LCA latin ou grec — Terminale", coef: 2, group: "options", year: "Tle", match: "lca", optional: true },
  ].filter(Boolean);

  const unverified = [];
  if (session >= 2028) unverified.push("Session 2028 : règles de la session 2027 reprises telles quelles, aucun texte spécifique vérifié.");
  if (eam) unverified.push("Rattrapage : la possibilité de repasser l'épreuve anticipée de mathématiques au second groupe n'a pas pu être vérifiée (non proposée ici).");

  return {
    scheme: "flat",
    session,
    items,
    pass: 10,
    secondGroup: { min: 8, max: 10, picks: 2,
      text: "Entre 8 et 10 : second groupe (rattrapage). Vous choisissez au plus 2 épreuves écrites (français, philosophie, spécialités) repassées à l'oral ; la meilleure des deux notes est gardée, avec le même coefficient. Pas de mention après le rattrapage." },
    mentions: MENTIONS,
    notes: [
      "Le jury peut ajouter des points, plafonnés à 0,5 sur la moyenne générale depuis la session 2026 (non simulés ici).",
      general ? null : "STI2D et STL : l'épreuve de spécialité « physique-chimie et mathématiques » compte comme une spécialité (coefficient 16).",
    ].filter(Boolean),
    unverified,
    sources: [SOURCES.memento, SOURCES.eam, SOURCES.jury, SOURCES.academie],
  };
}

// ---- Diplôme national du brevet (candidats scolaires) ----
// Final mark /20 = 40 % contrôle continu + 60 % épreuves (since the 2026 session).
// Contrôle continu = average of the annual averages of all compulsory 3e subjects,
// plus the points above 10 of ONE optional course (capped at 20).
// Épreuves: français 2, maths 2, histoire-géo 1,5 + EMC 0,5, sciences 2, oral 2.

function brevet(session) {
  return {
    scheme: "brevet",
    session,
    ccWeight: 0.4,
    examWeight: 0.6,
    items: [
      { id: "cc", label: "Moyenne des moyennes annuelles de 3e", coef: null, group: "cc", match: "brevet-cc",
        note: "Toutes les matières obligatoires de 3e comptent autant." },
      { id: "facultatif", label: "Enseignement facultatif (latin, chant choral, langue régionale…)", coef: null, group: "cc", match: "option1",
        optional: true, bonus: true, note: "Seuls les points au-dessus de 10 s'ajoutent à la moyenne de contrôle continu (sans dépasser 20)." },
      { id: "francais", label: "Français (écrit)", coef: 2, group: "exam", match: "french" },
      { id: "maths", label: "Mathématiques (écrit)", coef: 2, group: "exam", match: "math",
        note: "Dont 6 points d'automatismes sans calculatrice." },
      { id: "hg", label: "Histoire et géographie (écrit)", coef: 1.5, group: "exam", match: "hist" },
      { id: "emc", label: "Enseignement moral et civique (écrit)", coef: 0.5, group: "exam", match: "emc" },
      { id: "sciences", label: "Sciences : physique-chimie, SVT, technologie (écrit)", coef: 2, group: "exam", match: "sciences-college" },
      { id: "oral", label: "Oral (projet, histoire des arts…)", coef: 2, group: "exam", match: null },
    ],
    pass: 10,
    secondGroup: null,
    mentions: MENTIONS,
    notes: [
      "Pas de rattrapage au brevet. La moyenne de contrôle continu peut être harmonisée par une commission académique.",
    ],
    unverified: [
      "Ajout des points de l'option : lecture littérale de l'article 6 de l'arrêté (points au-dessus de 10 ajoutés à la moyenne de contrôle continu) — à vérifier.",
      session >= 2027 ? "Session 2027 : règles de la session 2026 reprises (un passage à 50/50 avait été évoqué, sans texte publié à notre connaissance) — à vérifier." : null,
    ].filter(Boolean),
    sources: [SOURCES.dnbArrete, SOURCES.dnbSP],
  };
}

// ---- Bac professionnel ----
// Coefficients depend on each spécialité's règlement d'examen: the list is
// editable. Common rules: admitted at 10; épreuve de contrôle between 8 and 10
// when the professional épreuves average at least 10.

function bacPro(session) {
  return {
    scheme: "custom",
    session,
    rowsTemplate: [
      { label: "Épreuve professionnelle (E2)", coef: 1, pro: true },
      { label: "Épreuve professionnelle (E3)", coef: 1, pro: true },
      { label: "Économie-droit ou économie-gestion", coef: 1, pro: true },
      { label: "Prévention santé environnement", coef: 1, pro: true },
      { label: "Mathématiques (et physique-chimie)", coef: 1 },
      { label: "Français", coef: 1 },
      { label: "Histoire-géographie et EMC", coef: 1 },
      { label: "Langue vivante", coef: 1 },
      { label: "Arts appliqués et cultures artistiques", coef: 1 },
      { label: "Éducation physique et sportive", coef: 1 },
    ],
    proFlag: true,
    pass: 10,
    secondGroup: { min: 8, max: 10, proMin: 10,
      text: "Entre 8 et 10, avec au moins 10 de moyenne aux épreuves professionnelles : épreuve de contrôle (2 oraux de 15 min, en enseignement général). Les meilleures notes sont gardées." },
    mentions: MENTIONS,
    notes: [
      "Les épreuves et coefficients dépendent de votre spécialité : recopiez ceux du règlement d'examen (référentiel du diplôme).",
    ],
    unverified: [
      "Coefficients de la liste : valeurs d'exemple à remplacer, non vérifiées.",
      session >= 2027 ? "Session 2027 (nouvelle organisation de la Terminale pro) : seuils supposés inchangés — à vérifier." : null,
    ].filter(Boolean),
    sources: [SOURCES.academie, SOURCES.bacProControle],
  };
}

// ---- Free weighted average ----
function weighted() {
  return {
    scheme: "custom",
    session: null,
    rowsTemplate: [
      { label: "Matière 1", coef: 1 },
      { label: "Matière 2", coef: 1 },
      { label: "Matière 3", coef: 1 },
    ],
    importPronote: true,
    pass: null,
    secondGroup: null,
    mentions: [],
    notes: ["Moyenne pondérée : somme (note × coefficient) ÷ somme des coefficients."],
    unverified: [],
    sources: [],
  };
}

export const CALCULATORS = [
  { id: "bac-general", label: "Bac général", sessions: [2026, 2027, 2028], build: (s) => bacGT("general", s), bac: true },
  { id: "bac-techno", label: "Bac techno", sessions: [2026, 2027, 2028], build: (s) => bacGT("techno", s), bac: true },
  { id: "brevet", label: "Brevet", sessions: [2026, 2027], build: brevet },
  { id: "bac-pro", label: "Bac pro", sessions: [2026, 2027], build: bacPro },
  { id: "moyenne", label: "Moyenne pondérée", sessions: [null], build: weighted },
];
