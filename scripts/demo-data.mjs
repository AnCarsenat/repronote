// Fills a data folder with made-up Pronote data, for screenshots and demos.
// Usage: node scripts/demo-data.mjs <dir>   then   REPRONOTE_DATA_DIR=<dir> npm run serve
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: node scripts/demo-data.mjs <dir>");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const SUBJECTS = [
  ["MATHEMATIQUES", "#4f8ff7", "M. Martin"],
  ["FRANCAIS", "#f78f4f", "Mme Bernard"],
  ["HISTOIRE-GEOGRAPHIE", "#c48bf2", "M. Petit"],
  ["ANGLAIS LV1", "#58c48a", "Mme Robert"],
  ["PHYSIQUE-CHIMIE", "#f2c94c", "M. Durand"],
  ["SCIENCES VIE & TERRE", "#6fcf97", "Mme Leroy"],
  ["ESPAGNOL LV2", "#eb5757", "M. Moreau"],
  ["ED.PHYSIQUE & SPORT.", "#56ccf2", "Mme Simon"],
  ["PHILOSOPHIE", "#bb6bd9", "M. Laurent"],
];
const subject = (i) => ({ id: `s${i}`, name: SUBJECTS[i][0], inGroups: false });
const num = (points) => ({ kind: 0, points });

const day = (offset, h = 0, m = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset); // offset from this Monday
  d.setHours(h, m);
  return d;
};
const iso = (d) => d.toISOString();

// Timetable: two weeks, with a free hour here and there.
const WEEK = [
  [[8, 0, 0], [9, 0, 1], [10, 15, 2], [13, 30, 4], [14, 30, 4]],
  [[8, 0, 3], [9, 0, 5], [11, 15, 0], [14, 30, 7], [15, 30, 7]],
  [[8, 0, 1], [9, 0, 6], [10, 15, 8], [11, 15, 8]],
  [[9, 0, 0], [10, 15, 3], [13, 30, 2], [14, 30, 5], [16, 30, 6]],
  [[8, 0, 4], [9, 0, 1], [10, 15, 0], [13, 30, 8]],
];
const timetable = [];
for (const week of [0, 7]) {
  WEEK.forEach((lessons, d) =>
    lessons.forEach(([h, m, s], k) => {
      const start = day(week + d, h, m);
      timetable.push({
        is: "lesson", id: `l${week}-${d}-${k}`, backgroundColor: SUBJECTS[s][1],
        startDate: iso(start), endDate: iso(new Date(+start + 55 * 60_000)),
        blockLength: 1, blockPosition: 0, weekNumber: 1, kind: 0,
        canceled: week === 0 && d === 3 && k === 1, exempted: false, test: week === 0 && d === 1 && k === 2,
        virtualClassrooms: [], personalNames: [], teacherNames: [SUBJECTS[s][2]],
        classrooms: [`${100 + ((s * 7) % 30)}`], groupNames: [], subject: subject(s), lessonResourceID: `r${week}-${d}-${k}`,
      });
    }),
  );
}

const HW = [
  [0, 1, "Exercices 12 à 15 page 87 (fonctions dérivées)."],
  [1, 1, "Lire le chapitre 3 de « Bel-Ami » et relever les portraits."],
  [3, 2, "Learn the vocabulary list (unit 4) — vocabulary quiz."],
  [4, 3, "Compte rendu du TP sur les dosages, à rendre sur l'ENT."],
  [2, 3, "Réviser la carte des métropoles françaises."],
  [6, 4, "Rédiger 10 lignes sur tu última vacación."],
  [8, 4, "Dissertation : « La technique nous libère-t-elle ? » — introduction et plan."],
  [0, 7, "DM n°4 : suites numériques."],
  [5, 8, "Schéma bilan de la photosynthèse."],
  [1, 9, "Commentaire de texte : préparation au bac blanc."],
];
const homework = HW.map(([s, offset, description], i) => ({
  id: `h${i}`, subject: subject(s), description: `<p>${description}</p>`, backgroundColor: SUBJECTS[s][1],
  done: i === 1 || i === 4, deadline: iso(day(offset, 8)), attachments: [], difficulty: 0, length: 0, themes: [],
  return: { kind: 0, canUpload: false }, resourceID: `res${i}`,
}));

const period = { id: "p1", kind: 0, name: "Trimestre 1", startDate: iso(day(-70)), endDate: iso(day(30)) };
const GRADES = [
  [0, 15.5, 20, 2], [0, 12, 20, 1], [0, 17, 20, 1], [1, 13, 20, 2], [1, 11.5, 20, 1], [2, 14, 20, 1], [2, 16.5, 20, 1],
  [3, 18, 20, 1], [3, 8.5, 10, 1], [4, 11, 20, 2], [4, 14.5, 20, 1], [5, 15, 20, 1], [6, 16, 20, 1], [7, 17, 20, 1], [8, 10.5, 20, 2],
];
const grades = GRADES.map(([s, v, outOf, coefficient], i) => ({
  id: `g${i}`, value: num(v), outOf: num(outOf), defaultOutOf: num(20), date: iso(day(-60 + i * 4)), subject: subject(s),
  average: num(outOf * 0.62), max: num(outOf * 0.95), min: num(outOf * 0.2), coefficient, comment: ["Contrôle", "Devoir maison", "Interrogation"][i % 3],
  isBonus: false, isOptional: false, isOutOf20: outOf === 20,
}));
const subjectsAverages = SUBJECTS.map((_, s) => {
  const mine = grades.filter((g) => g.subject.id === `s${s}`);
  const avg = mine.reduce((a, g) => a + (g.value.points / g.outOf.points) * 20 * g.coefficient, 0) / Math.max(1, mine.reduce((a, g) => a + g.coefficient, 0));
  return { student: num(+avg.toFixed(2)), outOf: num(20), defaultOutOf: num(20), class_average: num(12.4), min: num(6), max: num(18.5), subject: subject(s), backgroundColor: SUBJECTS[s][1] };
}).filter((a) => a.student.points > 0);

const news = {
  categories: ["Vie scolaire", "Orientation"],
  items: [
    { key: "n1", id: "n1", title: "Réunion parents-professeurs", is: "information", category: "Vie scolaire", author: "Direction", creationDate: iso(day(-2)), startDate: iso(day(-2)), endDate: iso(day(20)), read: false, hasAttachments: false, content: "<p>La réunion parents-professeurs des terminales aura lieu jeudi de 17 h à 20 h. Prenez rendez-vous avec les professeurs sur l'ENT.</p>", attachments: [] },
    { key: "n2", id: "n2", title: "Salon de l'orientation", is: "information", category: "Orientation", author: "CPE", creationDate: iso(day(-5)), startDate: iso(day(-5)), endDate: iso(day(10)), read: false, hasAttachments: false, content: "<p>Le salon de l'orientation se tient samedi au gymnase. Venez rencontrer les écoles et universités de la région.</p>", attachments: [] },
    { key: "n3", id: "n3", title: "Photos de classe", is: "information", category: "Vie scolaire", author: "Vie scolaire", creationDate: iso(day(-12)), startDate: iso(day(-12)), endDate: iso(day(5)), read: true, hasAttachments: false, content: "<p>Les photos de classe sont disponibles à la vie scolaire.</p>", attachments: [] },
  ],
};

const snapshots = {
  user: { name: "Camille Dupont", className: "TG3", establishment: "Lycée de démonstration" },
  account: { name: "Camille Dupont", className: "TG3", establishment: "Lycée de démonstration", address: [], postalCode: "", city: "", province: "", country: "", email: "", phone: "", INE: "", iCalURL: "", authorizations: { tabs: [] } },
  schoolYear: { firstDate: iso(day(-75)), lastDate: iso(day(220)), firstMonday: iso(day(-77)) },
  holidays: [{ id: "v1", name: "Vacances de Noël", startDate: iso(day(33)), endDate: iso(day(48)) }],
  timetable,
  homework,
  grades: { periods: [period], defaultPeriodId: "p1", byPeriod: { p1: { grades, subjectsAverages } } },
  news,
  notebook: { absences: [], delays: [], punishments: [], observations: [] },
};

const db = new DatabaseSync(join(dir, "pronote.db"));
db.exec(`
  CREATE TABLE snapshots (kind TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL);
  CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ok INTEGER NOT NULL, error_kind TEXT, message TEXT);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE pending (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
`);
const now = Date.now();
for (const [kind, data] of Object.entries(snapshots)) db.prepare("INSERT INTO snapshots VALUES (?, ?, ?)").run(kind, JSON.stringify(data), now);
db.prepare("INSERT INTO sync_log (at, ok) VALUES (?, 1)").run(now - 4 * 60_000);
console.log(`Demo data written to ${dir}`);
