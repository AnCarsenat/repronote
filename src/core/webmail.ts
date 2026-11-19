import { getBrowserDriver, type DriverPage } from "./browser-driver.ts";
import { BROWSER_PROFILE_DIR } from "./config.ts";

/**
 * Email addresses of the student's teachers and staff, looked up one person at
 * a time with the ENT webmail's own address autocomplete
 * (psn.monlycee.net/address-book/contacts?filter=…), from inside the webmail
 * page so its cookies apply. The user logs in to the webmail in the window.
 *
 * Deliberately narrow: only the names given (Pronote's messaging directory),
 * at most 2 queries per person, spaced out; nothing else is read or kept.
 */

const WEBMAIL = "https://web-mail.monlycee.net/main.html#inbox";
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const DELAY_MS = 450;

export type EmailLookup = { email: string | null; candidates: Array<{ name: string; email: string; type?: string }> };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9@.\s-]/g, " ").replace(/\s+/g, " ").trim();

/** "M. NOM P." / "Mme NOM-COMPOSE P." / "NOM PRENOM" -> { last, initial }. */
export function parseContactName(name: string): { last: string; initial: string } {
  const toks = name.replace(/\b(M|Mme|Mlle|Mr|Dr)\.?(?=\s)/g, "").trim().split(/\s+/);
  const last = toks.filter((t) => /^[A-ZÀ-Ü][A-ZÀ-Ü'-]+$/.test(t)).join(" ");
  const initial = toks.find((t) => /^[A-ZÀ-Ü]\.$/.test(t))?.[0] ?? "";
  return { last, initial };
}

/** The display name contains the last name, and a word starting with the initial (if known). */
function matches(displayName: string, last: string, initial: string): boolean {
  const dn = norm(displayName);
  if (!dn.includes(norm(last))) return false;
  if (!initial) return true;
  const rest = dn.replace(norm(last), " ").split(/[\s-]+/).filter(Boolean);
  return rest.some((w) => w.startsWith(norm(initial)));
}

export async function lookupEmails(names: string[], onProgress?: (msg: string) => void): Promise<Record<string, EmailLookup>> {
  // Shares the search box's webmail page (and its queue): no new window when one is open.
  const run = async () => {
    onProgress?.("Connexion au webmail…");
    const page = await webmailPage();
    if (held?.timer) clearTimeout(held.timer);
    try {
      const search = (filter: string) =>
        page.evaluate(async (q: string) => {
          const r = await fetch(`https://psn.monlycee.net/address-book/contacts?filter=${encodeURIComponent(q)}&_=${Date.now()}`, { credentials: "include" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as Array<{ displayName?: string; email?: string; type?: string }>;
        }, filter);

      const out: Record<string, EmailLookup> = {};
      for (const [i, name] of names.entries()) {
        const { last, initial } = parseContactName(name);
        if (!last) {
          out[name] = { email: null, candidates: [] };
          continue;
        }
        onProgress?.(`${i + 1}/${names.length}`);
        let results = await search(last);
        // Compound names: try the first part alone if nothing came back.
        if (!results.length && /[\s-]/.test(last)) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          results = await search(last.split(/[\s-]/)[0]);
        }
        const people = results.filter((r) => r.email && r.displayName);
        const good = people.filter((r) => matches(r.displayName!, last, initial));
        out[name] = {
          email: good.length === 1 ? good[0].email! : null,
          // Keep candidates only when the match is ambiguous, to check by hand.
          candidates: good.length === 1 ? [] : (good.length ? good : people.filter((r) => norm(r.displayName!).includes(norm(last))))
            .slice(0, 5)
            .map((r) => ({ name: r.displayName!, email: r.email!, type: r.type })),
        };
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      return out;
    } catch (err) {
      await closeWebmail();
      throw err;
    } finally {
      if (held) {
        held.timer = setTimeout(() => void closeWebmail(), IDLE_CLOSE_MS);
        held.timer.unref?.();
      }
    }
  };
  const result = lock.then(run, run);
  lock = result.catch(() => {});
  return result;
}

// ---- One address at a time: the search box (Mes données) ----------------------
//
// Faster than the list lookup above: the webmail page is opened once, hidden
// when the ENT still has a session (a window only when a login is needed), and
// kept for a few minutes, so a search is one or two directory requests. Better
// matching: every word typed counts (accents and case ignored, initials, the
// e-mail address too), and results are ranked.
//
// Still the webmail's own autocomplete, used the way a person would: one query
// typed by the user, at most 2 requests per search, spaced out, a cap per
// 10 minutes, nothing stored.

export type EmailSearchResult = { name: string; email: string; type?: string; score: number };

const IDLE_CLOSE_MS = 10 * 60_000;
const MAX_SEARCHES = 40; // per 10 minutes
let held: { page: DriverPage; timer?: ReturnType<typeof setTimeout> } | null = null;
let lock: Promise<unknown> = Promise.resolve();
let lastRequest = 0;
const recent: number[] = [];

const onWebmail = (page: DriverPage) => /^https:\/\/web-mail\.monlycee\.net\/main\.html/.test(page.url());

async function waitForWebmail(page: DriverPage, timeoutMs: number): Promise<boolean> {
  let closed = false;
  page.onClose(() => (closed = true));
  const deadline = Date.now() + timeoutMs;
  while (!onWebmail(page)) {
    if (closed) throw new Error("Fenêtre fermée avant la connexion au webmail.");
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return true;
}

/** The webmail page, logged in: kept from the last search, or opened (hidden first). */
async function webmailPage(): Promise<DriverPage> {
  if (held && onWebmail(held.page)) return held.page;
  await closeWebmail();
  const driver = await getBrowserDriver();
  // Hidden: works when the ENT session cookies are still valid.
  let page = await driver.openPage({ interactive: false, profileDir: BROWSER_PROFILE_DIR });
  await page.goto(WEBMAIL).catch(() => {});
  if (!(await waitForWebmail(page, 15_000).catch(() => false))) {
    await page.close().catch(() => {});
    page = await driver.openPage({ interactive: true, profileDir: BROWSER_PROFILE_DIR });
    await page.goto(WEBMAIL);
    if (!(await waitForWebmail(page, LOGIN_TIMEOUT_MS))) {
      await page.close().catch(() => {});
      throw new Error("Délai dépassé pour la connexion au webmail.");
    }
  }
  await new Promise((r) => setTimeout(r, 1500)); // the app sets its cookies while starting
  held = { page };
  return page;
}

export async function closeWebmail(): Promise<void> {
  const h = held;
  held = null;
  if (h?.timer) clearTimeout(h.timer);
  await h?.page.close().catch(() => {});
}

/** Words of a query: accents/case removed, civilities dropped ("M.", "Mme"…). */
export function queryWords(q: string): string[] {
  return norm(q.replace(/\b(M|Mme|Mlle|Mr|Dr|Monsieur|Madame)\b\.?/gi, " ")).split(/[\s.@-]+/).filter(Boolean);
}

/**
 * How well a directory entry matches the words typed: whole word > word start >
 * inside a word; one-letter words are initials. 0 when a word matches nothing.
 */
export function scoreEntry(entry: { displayName?: string; email?: string; searchName?: string }, words: string[]): number {
  const nameWords = norm(entry.searchName ?? entry.displayName ?? "").split(/[\s'-]+/).filter(Boolean);
  const local = norm((entry.email ?? "").split("@")[0]).split(/[._-]+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    let best = 0;
    for (const n of nameWords) {
      if (w.length === 1) best = Math.max(best, n.startsWith(w) ? 2 : 0);
      else best = Math.max(best, n === w ? 6 : n.startsWith(w) ? 4 : n.includes(w) ? 2 : 0);
    }
    for (const l of local) {
      if (w.length === 1) best = Math.max(best, l.startsWith(w) ? 1 : 0);
      else best = Math.max(best, l === w ? 5 : l.startsWith(w) ? 3 : l.includes(w) ? 1 : 0);
    }
    if (!best) return 0; // every word must be found somewhere
    score += best;
  }
  return score;
}

/** The list in the directory's answer (an array, or an object holding one). */
function directoryEntries(body: unknown): any[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const v of Object.values(body)) if (Array.isArray(v)) return v;
  }
  return [];
}

/** Name and address of an entry, whatever the field names. */
function toEntry(r: any): { displayName: string; email: string; type?: string } | null {
  if (!r || typeof r !== "object") return null;
  const first = r.firstName ?? r.firstname ?? r.givenName ?? "";
  const last = r.lastName ?? r.lastname ?? r.familyName ?? r.surname ?? "";
  const displayName = String(r.displayName ?? r.name ?? r.fullName ?? `${last} ${first}`).trim();
  const mails = [r.email, r.mail, r.emailAddress, r.address, ...(Array.isArray(r.emails) ? r.emails.map((e: any) => e?.address ?? e?.value ?? e) : [])];
  const email = mails.find((m) => typeof m === "string" && m.includes("@"));
  // Keep first and last name in the searchable name even when displayName lacks one.
  const name = [displayName, first, last].filter((x, i, all) => x && !all.slice(0, i).some((y) => y && String(y).toLowerCase().includes(String(x).toLowerCase()))).join(" ");
  return email && name ? { displayName: displayName || name, email, type: r.type ?? r.profile ?? r.kind, ...(name !== displayName ? { searchName: name } : {}) } as any : null;
}

export function searchEmail(query: string): Promise<EmailSearchResult[]> {
  const run = async () => {
    const words = queryWords(query);
    const long = words.filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
    if (!long.length || long.join("").length < 3) throw new Error("Tapez au moins 3 lettres d'un nom.");
    const now = Date.now();
    while (recent.length && now - recent[0] > 10 * 60_000) recent.shift();
    if (recent.length >= MAX_SEARCHES) throw new Error("Trop de recherches d'affilée : réessayez dans quelques minutes.");
    recent.push(now);

    const page = await webmailPage();
    if (held?.timer) clearTimeout(held.timer);
    const ask = async (filter: string) => {
      const wait = lastRequest + DELAY_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequest = Date.now();
      const body = await page.evaluate(async (q: string) => {
        const r = await fetch(`https://psn.monlycee.net/address-book/contacts?filter=${encodeURIComponent(q)}&_=${Date.now()}`, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as unknown;
      }, filter);
      const list = directoryEntries(body);
      // Counts and field names only (never names or addresses): enough to see what the directory sends.
      console.log(`[email-search] request (${filter.length} letters): ${list.length} entries` +
        `${Array.isArray(body) ? "" : ` in {${Object.keys((body as object) ?? {}).join(",")}}`}` +
        `${list[0] ? `, fields ${Object.keys(list[0]).join(",")}` : ""}`);
      return list.map(toEntry).filter((r): r is { displayName: string; email: string; type?: string } => Boolean(r));
    };
    try {
      // Every word may be the last name or the first name: ask the directory for
      // the two longest (one request for a single word), merge, then keep and
      // rank the people matching every word typed.
      const byEmail = new Map<string, { displayName: string; email: string; type?: string }>();
      // Sent as typed (accents kept: the directory may need them).
      const typed = query.split(/[\s.@-]+/).filter(Boolean);
      for (const w of long.slice(0, 2)) {
        for (const r of await ask(typed.find((t) => norm(t) === w) ?? w)) byEmail.set(r.email.toLowerCase(), r);
      }
      const ranked = [...byEmail.values()]
        .map((r) => ({ name: r.displayName, email: r.email, type: r.type, score: scoreEntry(r, words) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      console.log(`[email-search] ${byEmail.size} people, ${ranked.length} matching every word`);
      return ranked.slice(0, 15);
    } catch (err) {
      await closeWebmail(); // logged out, page gone…: start fresh next time
      throw err;
    } finally {
      if (held) {
        held.timer = setTimeout(() => void closeWebmail(), IDLE_CLOSE_MS);
        held.timer.unref?.();
      }
    }
  };
  const result = lock.then(run, run);
  lock = result.catch(() => {});
  return result;
}

