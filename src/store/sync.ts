import * as pronote from "@blockshub/pawnote-lts";
import { rawRequest } from "../core/raw-request.ts";
import { attachmentURL } from "../core/attachments.ts";
import { newsKey, pageNews, setKnownNews } from "../core/browser-session.ts";
import { cacheFromURL } from "./files.ts";
import type { Store } from "./store.ts";

const DAY = 864e5;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date) => {
  const day = startOfDay(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // back to Monday
  return day;
};

/** Sends actions made offline (ticked homework...) before fetching. */
export async function flushPending(session: pronote.SessionHandle, store: Store): Promise<void> {
  for (const action of store.pending()) {
    if (action.type === "homeworkDone") {
      await pronote.assignmentStatus(session, action.payload.id, action.payload.done);
    }
    store.removePending(action.id);
  }
}

/**
 * Fetches everything the UI shows and saves it in the store.
 * Each kind is fetched separately so one failure doesn't lose the others.
 * Returns the kinds that failed.
 */
export async function syncAll(session: pronote.SessionHandle, store: Store): Promise<Record<string, string>> {
  const failures: Record<string, string> = {};
  const today = startOfDay(new Date());
  const monday = startOfWeek(today);

  try {
    await flushPending(session, store);
  } catch (err) {
    failures.pending = err instanceof Error ? err.message : String(err);
  }

  const tasks: Record<string, () => Promise<unknown>> = {
    user: async () => ({
      name: session.user.name,
      className: session.userResource.className,
      establishment: session.userResource.establishmentName,
    }),

    homework: () =>
      pronote.assignmentsFromIntervals(session, new Date(today.getTime() - 14 * DAY), new Date(today.getTime() + 35 * DAY)),

    // Last week to 3 weeks ahead.
    timetable: async () => {
      const from = new Date(monday.getTime() - 7 * DAY);
      const timetable = await pronote.timetableFromIntervals(session, from, new Date(monday.getTime() + 28 * DAY));
      pronote.parseTimetable(session, timetable, { withCanceledClasses: true, withPlannedClasses: true });
      return timetable.classes;
    },

    // Every period of the grades tab (trimesters/semesters, year...).
    grades: async () => {
      const tab = session.userResource.tabs.get(pronote.TabLocation.Grades);
      if (!tab) return { periods: [], defaultPeriodId: null, byPeriod: {} };
      const byPeriod: Record<string, unknown> = {};
      for (const period of tab.periods) {
        byPeriod[period.id] = await pronote.gradesOverview(session, period);
      }
      return { periods: tab.periods, defaultPeriodId: tab.defaultPeriod?.id ?? null, byPeriod };
    },

    holidays: async () => session.instance.holidays,

    // "Mes données": what Pronote knows about you.
    account: async () => {
      const a = await pronote.account(session);
      return {
        name: session.user.name,
        className: session.userResource.className,
        establishment: session.userResource.establishmentName,
        address: a.address.filter(Boolean),
        postalCode: a.postalCode,
        city: a.city,
        province: a.province,
        country: a.country,
        email: a.email,
        phone: a.phone,
        INE: a.INE,
        iCalURL: a.iCalToken ? pronote.timetableICalURL(session, a.iCalToken) : null,
        authorizations: session.user.authorizations,
      };
    },

    // Informations & surveys. pawnote's decoder breaks on Pronote 2026: the list
    // comes from PageActualites directly; texts come from Pronote's own page at
    // login (browser-session.ts) and are kept across syncs.
    news: async () => {
      const raw = await rawRequest(session, "PageActualites", { genreRequeteActualite: 0, modesAffActus: { _T: 26, V: "[0]" } }, pronote.TabLocation.News);
      const items = list(list(raw.listeModesAff)[0]?.listeActualites);
      const previous = new Map((store.get<any>("news")?.items ?? []).map((i: any) => [i.key, i]));
      const out = [];
      for (const it of items) {
        const created = pronoteDate(it.dateCreation);
        const key = newsKey(it.L, created);
        const old: any = previous.get(key);
        let questions = old?.questions ?? null;
        const fresh = pageNews.get(key);
        if (!questions && fresh) {
          questions = fresh.questions;
          // Attachment ids only work in this session: save the files now.
          for (const f of questions.flatMap((q: any) => q.attachments)) {
            if (f.kind === 0) continue;
            await cacheFromURL(`att:${f.id}:${f.name}`, attachmentURL(session, f.id, f.name)).catch(() => null);
          }
        }
        out.push({
          key,
          id: it.N,
          title: it.L,
          is: it.estSondage ? "survey" : "information",
          category: it.nature?.V?.L ?? null,
          author: it.auteur ?? it.elmauteur?.V?.L ?? "",
          creationDate: created,
          startDate: pronoteDate(it.dateDebut),
          endDate: pronoteDate(it.dateFin),
          read: Boolean(it.lue),
          hasAttachments: Boolean(it.informationListeContenu?.avecPJ),
          answered: it.informationListeContenu?.aToutRepondu ?? null,
          questions,
          content: questions ? questions.map((q: any) => q.html).filter(Boolean).join("<hr>") : null,
          attachments: questions ? questions.flatMap((q: any) => q.attachments) : [],
        });
      }
      setKnownNews(out.filter((i) => i.questions).map((i) => i.key));
      return { categories: list(raw.listeNatures).map((c) => c.L), items: out };
    },

    // Carnet: absences, delays, punishments, observations, for every period (deduplicated).
    notebook: async () => {
      const tab = session.userResource.tabs.get(pronote.TabLocation.Notebook);
      const out: Record<string, Map<string, unknown>> = {
        absences: new Map(), delays: new Map(), punishments: new Map(), observations: new Map(), precautionaryMeasures: new Map(),
      };
      for (const period of tab?.periods ?? []) {
        const nb = await pronote.notebook(session, period);
        for (const key of Object.keys(out)) for (const item of (nb as any)[key] ?? []) out[key].set(item.id, item);
      }
      return Object.fromEntries(Object.entries(out).map(([k, m]) => [k, [...m.values()]]));
    },

    // Lesson contents (cahier de textes): 4 weeks back, 1 week ahead.
    resources: () => pronote.resourcesFromIntervals(session, new Date(today.getTime() - 28 * DAY), new Date(today.getTime() + 7 * DAY)),

    // Report cards per grades period (often only published at the end of a period).
    gradebooks: async () => {
      const tab = session.userResource.tabs.get(pronote.TabLocation.Gradebook) ?? session.userResource.tabs.get(pronote.TabLocation.Grades);
      const out = [];
      for (const period of tab?.periods ?? []) {
        try {
          const book = await pronote.gradebook(session, period);
          let pdf: string | null = null;
          try {
            pdf = await pronote.gradebookPDF(session, period);
          } catch {}
          out.push({ period, available: true, ...book, pdf });
        } catch (err) {
          out.push({ period, available: false, reason: err instanceof Error ? err.message : String(err) });
        }
      }
      return out;
    },

    // Documents (casier numérique). pawnote has no wrapper: call Pronote's "Casier" function.
    documents: async () => {
      let lastError: unknown;
      for (const onglet of [103, 104, 102, 148]) {
        try {
          return decodeCasier(await rawRequest(session, "Casier", { genreRequeteCasier: 0 }, onglet));
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    },
  };

  for (const [kind, fetch] of Object.entries(tasks)) {
    try {
      store.put(kind, await fetch());
    } catch (err) {
      failures[kind] = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  // Ticks still waiting (failed above) must survive the fresh homework list.
  applyPendingToSnapshot(store);
  return failures;
}

export function applyPendingToSnapshot(store: Store): void {
  const pending = store.pending().filter((p) => p.type === "homeworkDone");
  if (!pending.length) return;
  store.patch<any[]>("homework", (list) =>
    list.map((a) => {
      const p = pending.findLast((x) => x.payload.id === a.id);
      return p ? { ...a, done: p.payload.done, pending: true } : a;
    }),
  );
}

/** "dd/mm/yyyy[ hh:mm[:ss]]" from Pronote to an ISO string. */
function pronoteDate(v: any): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/.exec(v?.V ?? v ?? "");
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)).toISOString() : null;
}

const list = (v: any): any[] => (Array.isArray(v) ? v : Array.isArray(v?.V) ? v.V : []);
const category = (c: any) => (c ? { name: c.V?.L ?? c.L, color: c.V?.couleur ?? c.couleur } : null);

/** Casier response -> documents, generated documents and every report card. */
function decodeCasier(raw: any) {
  return {
    categories: list(raw.categories).map((c) => ({ name: c.L, color: c.couleur })),
    files: list(raw.listeDocumentsCasier).map((d) => ({
      id: d.documentCasier?.V?.N ?? d.N,
      name: d.documentCasier?.V?.L ?? d.L,
      kind: d.documentCasier?.V?.G ?? 1,
      url: d.documentCasier?.V?.url ?? null,
      date: pronoteDate(d.date),
      category: category(d.categorie),
      memo: d.memo || "",
      unread: Boolean(d.estNonLu),
    })),
    generated: list(raw.listeDocuments).map((d) => ({
      id: d.N,
      name: d.L,
      from: pronoteDate(d.dateDebutPublication),
      to: pronoteDate(d.dateFinPublication),
      category: category(d.categorie),
      unread: Boolean(d.estNonLu),
    })),
    bulletins: [...list(raw.listeBulletinsBIA), ...list(raw.listeBulletins)].map((b) => ({
      ident: b.ident,
      file: b.nomFichier,
      label: b.libelle ?? "Bulletin",
      year: b.libelleAnnee,
      yearStart: b.annee,
      className: b.libelleClasse,
      period: b.libellePeriodeNotation,
    })),
    reports: list(raw.listeBilansPeriodiques).length,
  };
}
