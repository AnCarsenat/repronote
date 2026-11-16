// Subject coefficient presets for the computed overall average.
// Weights follow the official exams (bac / brevet); a school's own report-card
// coefficients may differ, so presets are a starting point you can edit.
//
// A rule matches the subject name (uppercase, without accents). First match wins.

const normalize = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const R = {
  option: /\bOPTION\b|EXPERT|COMPLEMENTAIRE|\bLATIN\b|\bGREC\b|\bLCA\b|DGEMC|\bFACULTATI/,
  spe: /^SPE\b|\bSPE\s*[-–]|SPECIALITE/,
  philo: /PHILO/,
  french: /FRANCAIS/,
  hist: /HIST|GEOG/,
  eps: /\bEPS\b|ED\.?\s*PHYSIQUE|EDUCATION PHYSIQUE|PHYSIQUE\s*&\s*SPORT|SPORT/,
  lv: /^LV|\bLV[ABC123]?\b|ANGLAIS|ESPAGNOL|ALLEMAND|ITALIEN|CHINOIS|ARABE|PORTUGAIS|RUSSE/,
  sci: /ENSEIGN.*SCIENTIFIQUE|\bENS\.?\s*SCI/,
  emc: /\bE\.?\s*M\.?\s*C\b|MORAL|CIVIQUE/,
  math: /MATH/,
  pc: /PHYSIQUE.?CHIMIE|SCIENCES PHYSIQUES/,
  svt: /\bSVT\b|SCIENCES DE LA VIE/,
  techno: /TECHNO/,
};

export const PRESETS = [
  {
    id: "equal",
    label: "Toutes les matières à 1",
    description: "Moyenne simple des matières.",
    rules: [],
  },
  {
    id: "bac-terminale",
    label: "Bac général — Terminale",
    description: "Poids du bac : spécialités 16, philosophie 8, histoire-géo, langues, EPS et enseignement scientifique 6, EMC 2, options 2.",
    rules: [
      [R.option, 2, "option"],
      [R.spe, 16, "spécialité"],
      [R.philo, 8, "philosophie"],
      [R.hist, 6, "histoire-géo"],
      [R.eps, 6, "EPS"],
      [R.lv, 6, "langue vivante"],
      [R.sci, 6, "enseignement scientifique"],
      [R.emc, 2, "EMC"],
    ],
  },
  {
    id: "bac-premiere",
    label: "Bac général — Première",
    description: "Français 10 (épreuves anticipées), spécialités 8, histoire-géo, langues, EPS et enseignement scientifique 6, EMC 2, options 2.",
    rules: [
      [R.option, 2, "option"],
      [R.spe, 8, "spécialité"],
      [R.french, 10, "français"],
      [R.hist, 6, "histoire-géo"],
      [R.eps, 6, "EPS"],
      [R.lv, 6, "langue vivante"],
      [R.sci, 6, "enseignement scientifique"],
      [R.emc, 2, "EMC"],
    ],
  },
  {
    id: "bac-techno",
    label: "Bac technologique — Terminale",
    description: "Spécialités 16, philosophie 4, histoire-géo, langues, EPS et mathématiques 6, EMC 2, options 2.",
    rules: [
      [R.option, 2, "option"],
      [R.spe, 16, "spécialité"],
      [R.philo, 4, "philosophie"],
      [R.hist, 6, "histoire-géo"],
      [R.eps, 6, "EPS"],
      [R.lv, 6, "langue vivante"],
      [R.math, 6, "mathématiques"],
      [R.emc, 2, "EMC"],
    ],
  },
  {
    id: "brevet",
    label: "Collège — Brevet (3e)",
    description: "Poids des épreuves du brevet : français et maths 4, histoire-géo 2, physique-chimie, SVT et technologie 1, autres matières 1.",
    rules: [
      [R.option, 1, "option"],
      [R.french, 4, "français"],
      [R.math, 4, "mathématiques"],
      [R.hist, 2, "histoire-géo-EMC"],
      [R.pc, 1, "physique-chimie"],
      [R.svt, 1, "SVT"],
      [R.techno, 1, "technologie"],
    ],
  },
];

/** What a preset gives for one subject: { coef, mode, reason }. */
export function presetFor(preset, subjectName) {
  const name = normalize(subjectName);
  for (const [re, coef, reason] of preset.rules) {
    if (re.test(name)) return { coef, mode: "normal", reason };
  }
  return { coef: 1, mode: "normal", reason: preset.rules.length ? "autre matière" : null };
}

/** Settings for all given subjects from a preset. */
export function applyPreset(preset, subjectNames) {
  return Object.fromEntries(subjectNames.map((n) => {
    const { coef, mode } = presetFor(preset, n);
    return [n, { coef, mode }];
  }));
}
