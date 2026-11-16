import { getBrowserDriver } from "./browser-driver.ts";
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
  const driver = await getBrowserDriver();
  const page = await driver.openPage({ interactive: true, profileDir: BROWSER_PROFILE_DIR });
  try {
    await page.goto(WEBMAIL);
    onProgress?.("Connectez-vous au webmail dans la fenêtre…");

    // Logged in once the webmail app itself is shown.
    let closed = false;
    page.onClose(() => (closed = true));
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (!/^https:\/\/web-mail\.monlycee\.net\/main\.html/.test(page.url())) {
      if (closed) throw new Error("Fenêtre fermée avant la connexion au webmail.");
      if (Date.now() > deadline) throw new Error("Délai dépassé pour la connexion au webmail.");
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 2500)); // let the app finish starting

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
  } finally {
    await page.close().catch(() => {});
  }
}
