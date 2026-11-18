import { createCipheriv, createHash } from "node:crypto";
import { getBrowserDriver, type DriverPage } from "./browser-driver.ts";
import * as pronote from "@blockshub/pawnote-lts";
import { BROWSER_PROFILE_DIR } from "./config.ts";
import { decodeInstanceParameters } from "./instance-parameters.ts";
import { decodeUserParameters } from "./user-parameters.ts";

/**
 * Logs in through a real browser and hands the live Pronote session to pawnote.
 *
 * 1. Chromium (persistent profile) opens the Pronote page. The school's ENT/CAS
 *    login happens there: by itself if the ENT cookies are still valid,
 *    otherwise the user logs in in the window.
 * 2. Once Pronote has loaded the user (`ParametresUtilisateur`) and the page
 *    is idle, we freeze the page's communication object so it sends nothing
 *    more, not even the logout beacon fired when the page closes.
 * 3. We copy the session id, AES key/IV and request counter into a pawnote
 *    session, plus the `FonctionParametres` response captured on the way.
 *    From there the whole pawnote API works on that session.
 */

export class InteractiveLoginRequired extends Error {
  constructor() {
    super("The ENT wants you to log in again.");
    this.name = "InteractiveLoginRequired";
  }
}

const SPACE_PAGE: Record<number, string> = {
  [pronote.AccountKind.STUDENT]: "mobile.eleve.html",
  [pronote.AccountKind.PARENT]: "mobile.parent.html",
  [pronote.AccountKind.TEACHER]: "mobile.professeur.html",
};

type Options = {
  url: string;
  kind?: pronote.AccountKind;
  /** Show the window and give the user time to log in. */
  interactive: boolean;
};

const AUTO_LOGIN_TIMEOUT_MS = 30_000;
const INTERACTIVE_TIMEOUT_MS = 5 * 60_000;
const IDLE_MS = 1_500;

type Captured = {
  start?: Record<string, unknown>;
  instanceParameters?: any;
  userParameters?: any;
  userLoaded: boolean;
  pending: number;
  /** Short log of the page's Pronote traffic, for error reports. */
  trace: string[];
  lastActivity: number;
  /** A reason the login can't work, found while watching (thrown by waitUntilReady). */
  fatal?: Error;
};

type FrozenCommunication = {
  sessionId: number;
  nextOrder: number;
  keyHex: string;
  ivHex: string;
};

export async function openBrowserSession(options: Options): Promise<pronote.SessionHandle> {
  const base = pronote.cleanURL(options.url);
  const kind = options.kind ?? pronote.AccountKind.STUDENT;
  const driver = await getBrowserDriver();

  // The school server sometimes drops a script download; Pronote's page
  // then logs itself out ("Échec lors du chargement de la page"). Retry.
  for (let attempt = 1; ; attempt++) {
    const page = await driver.openPage({ interactive: options.interactive, profileDir: BROWSER_PROFILE_DIR });
    try {
      return await attemptSession(page, base, kind, options.interactive);
    } catch (err) {
      if (!(err instanceof PageStartFailed) || attempt >= MAX_ATTEMPTS) throw err;
      console.error(`Pronote page failed to start (attempt ${attempt}/${MAX_ATTEMPTS}), retrying...`);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

const MAX_ATTEMPTS = 3;

/** The page loaded but Pronote couldn't start its session in it. Worth retrying. */
class PageStartFailed extends Error {
  name = "PageStartFailed";
}

async function attemptSession(
  page: DriverPage,
  base: string,
  kind: pronote.AccountKind,
  interactive: boolean,
): Promise<pronote.SessionHandle> {
  const captured = watchPronoteTraffic(page);
  const step = (msg: string) => process.env.REPRONOTE_DEBUG && console.log(`[login] ${msg}`);
  step("page opened");

  // Look like a fresh browser to Pronote (its storage holds a navigator id
  // tied to earlier sessions). ENT cookies live on another origin and stay.
  await page.clearOriginData(new URL(base).origin);

  step("storage cleared");
  await page.goto(`${base}/${SPACE_PAGE[kind]}?fd=1`);
  step(`navigated: ${page.url()}`);
  await waitUntilReady(page, captured, interactive);
  step(`ready (${captured.trace.length} Pronote calls)`);

  // News texts: Pronote 2026 rejects our own detail request, but its page can
  // fetch them. Only items not seen before. Must run before the freeze.
  try {
    const found = await page.evaluate(newsFromPage, [...knownNews]);
    for (const item of found.items) pageNews.set(item.key, item);
    console.log(`[news] ${found.total} in list, ${found.items.length} texts fetched${found.errors.length ? `, ${found.errors.length} failed: ${found.errors.slice(0, 3).join(" | ")}` : ""}`);
  } catch (err) {
    console.error(`[news] ${err instanceof Error ? err.message : err}`);
  }

  const frozen = await freezeWithRetry(page).catch(async (err) => {
    await page.screenshot(`${BROWSER_PROFILE_DIR}/../last-error.png`).catch(() => {});
    const message = `${err instanceof Error ? err.message : err}\nPronote traffic: ${captured.trace.join(" | ")}`;
    throw new PageStartFailed(message);
  });
  if (!captured.start) throw new Error("Did not see the Pronote page load (no Start(...) call).");
  if (!captured.instanceParameters) throw new Error("Did not capture FonctionParametres.");
  if (!captured.userParameters) throw new Error("Did not capture ParametresUtilisateur.");

  return toPawnoteSession(base, kind, captured, frozen);
}

function watchPronoteTraffic(page: DriverPage): Captured {
  const captured: Captured = { userLoaded: false, pending: 0, lastActivity: Date.now(), trace: [] };
  const isApi = (url: string) => url.includes("/appelfonction/");

  page.onRequest((url) => {
    if (isApi(url)) {
      captured.pending++;
      captured.lastActivity = Date.now();
    }
  });
  const done = (url: string) => {
    if (isApi(url)) {
      captured.pending = Math.max(0, captured.pending - 1);
      captured.lastActivity = Date.now();
    }
  };
  page.onRequestFailed((url, error) => {
    captured.trace.push(`FAILED ${url ? new URL(url).pathname.split("/").slice(-3).join("/") : "?"} ${error}`);
    done(url);
  });

  page.onResponse(async (res) => {
    const url = res.url;
    try {
      if (res.isDocument && url.includes(".html")) {
        const match = (await res.text()).match(/Start\s*\(\s*(\{[^}]*\})/);
        if (match) captured.start = JSON.parse(match[1]);
      } else if (isApi(url)) {
        const body = JSON.parse(await res.text());
        captured.trace.push(`${body.id ?? body.nom ?? "?"} ${res.status}${body.Erreur ? ` Erreur=${JSON.stringify(body.Erreur).slice(0, 150)}` : ""}`);
        const data = body.dataSec ?? body.donneesSec;
        if (typeof data === "string") {
          // Not thrown here: this callback's promise isn't awaited by the drivers,
          // so a throw would be an unhandled rejection that kills the process.
          // waitUntilReady reports it as the login failure instead.
          captured.fatal = new Error("This Pronote server encrypts its traffic; not supported yet.");
          return;
        }
        if (body.id === "FonctionParametres" || body.nom === "FonctionParametres") {
          captured.instanceParameters = data?.data ?? data?.donnees;
        }
        if (body.id === "ParametresUtilisateur" || body.nom === "ParametresUtilisateur") {
          captured.userParameters = data?.data ?? data?.donnees;
          captured.userLoaded = true;
        }
      }
    } catch {
      // Body unavailable (redirects etc.): ignore.
    } finally {
      done(url);
    }
  });

  return captured;
}

async function waitUntilReady(page: DriverPage, captured: Captured, interactive: boolean): Promise<void> {
  const deadline = Date.now() + (interactive ? INTERACTIVE_TIMEOUT_MS : AUTO_LOGIN_TIMEOUT_MS);
  let closed = false;
  page.onClose(() => (closed = true));

  while (Date.now() < deadline) {
    if (captured.fatal) throw captured.fatal;
    if (closed) throw new Error("Browser window closed before login finished.");
    if (captured.userLoaded && captured.pending === 0 && Date.now() - captured.lastActivity > IDLE_MS) {
      return;
    }
    await page.submitAutofilledLogin().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!interactive) throw new InteractiveLoginRequired();
  throw new Error("Timed out waiting for login.");
}

/** The page may still be navigating or initialising: retry for a few seconds. */
async function freezeWithRetry(page: DriverPage): Promise<FrozenCommunication> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      return await page.evaluate(freezeCommunication);
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/**
 * Runs inside the Pronote page. Finds the communication object, reads its
 * state, then stops it so the page can't touch the session again.
 */
function freezeCommunication(): FrozenCommunication {
  const isCommunication = (o: any) =>
    o && typeof o === "object" && "NumeroOrdreCommunication" in o && o.cleAES && o.ivAES;

  // Pronote keeps it at GApplication.communication, with GApplication inside
  // its module system. The page exposes a global `require` to reach it.
  let app: any = (window as any).GApplication;
  const req = (window as any).require;
  for (const id of ["@cp/script/AccessApp", "accessapp.js", "AccessApp"]) {
    if (app || typeof req !== "function") break;
    try {
      app = req(id)?.getApp?.();
    } catch {}
  }
  let comm: any = app?.getCommunication?.() ?? app?.communication ?? null;

  // Fallback: search Pronote's globals.
  const roots: any[] = [app, window];
  const seen = new Set<any>();
  let queue: Array<{ value: any; depth: number }> = comm ? [] : roots.map((value) => ({ value, depth: 0 }));

  while (queue.length && !comm) {
    const { value, depth } = queue.shift()!;
    if (!value || typeof value !== "object" || seen.has(value) || value instanceof Node) continue;
    seen.add(value);
    if (isCommunication(value)) {
      comm = value;
      break;
    }
    if (depth >= 4) continue;
    let keys: string[] = [];
    try {
      keys = Object.keys(value);
    } catch {}
    for (const key of keys) {
      if (value === window && !key.startsWith("G")) continue; // only Pronote globals
      try {
        queue.push({ value: value[key], depth: depth + 1 });
      } catch {}
    }
  }
  if (!comm) {
    let viaRequire: string;
    try {
      const mod = req?.("accessapp.js");
      viaRequire = mod ? `module keys=[${Object.keys(mod)}], getApp()=${typeof mod.getApp?.()}` : String(mod);
    } catch (e) {
      viaRequire = `threw ${e}`;
    }
    throw new Error(
      `Could not find Pronote's communication object (url=${location.href}, ` +
        `require=${typeof req}, accessapp.js -> ${viaRequire}, ` +
        `app.communication=${app?.communication ? `{estArrete:${app.communication.estArrete}, keys:[${Object.keys(app.communication)}]}` : app?.communication}, ` +
        `page text: ${JSON.stringify((document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 400))})`,
    );
  }
  if (comm.estArrete) throw new Error("Pronote's session in the page is already closed.");

  const state: FrozenCommunication = {
    sessionId: comm.NumeroDeSession,
    nextOrder: comm.NumeroOrdreCommunication,
    keyHex: comm.cleAES.toHex(),
    ivHex: comm.ivAES.toHex(),
  };

  // Stop the page: no polling, no more requests, no logout beacon on close.
  try {
    comm.desactiverPolling?.();
  } catch {}
  comm._requeteDeconnexionEnvoyee = true;
  comm.estArrete = true;
  return state;
}

async function toPawnoteSession(
  base: string,
  kind: pronote.AccountKind,
  captured: Captured,
  frozen: FrozenCommunication,
): Promise<pronote.SessionHandle> {
  const start = captured.start!;
  const bytes = (hex: string) => Buffer.from(hex, "hex").toString("latin1");

  const session = pronote.createSessionHandle();
  session.information = {
    id: frozen.sessionId,
    accountKind: (start.a as pronote.AccountKind) ?? kind,
    demo: Boolean(start.d),
    url: base,
    accessKind: (start.g as pronote.SessionAccessKind) ?? pronote.SessionAccessKind.ACCOUNT,
    rsaModulus: "",
    rsaExponent: "",
    rsaFromConstants: true,
    aesKey: bytes(frozen.keyHex),
    aesIV: bytes(frozen.ivHex),
    // Same rule as pawnote for Pronote >= 2025.1.3.
    skipEncryption: !start.CrA,
    skipCompression: !start.CoA,
    http: Boolean(start.http),
    poll: false,
    // Pronote keeps the next number to send; pawnote keeps the last one used.
    order: frozen.nextOrder - 1,
  };
  session.instance = decodeInstanceParameters(captured.instanceParameters);

  session.user = decodeUserParameters(captured.userParameters, session);
  pronote.use(session, 0);
  return session;
}

/**
 * Logs the session out, like Pronote's own beacon when its page closes.
 * Without this the session stays open server-side and Pronote refuses the
 * next login from the same browser ("Vous avez été déconnecté").
 */
export async function closeSession(session: pronote.SessionHandle): Promise<void> {
  const { information } = session;
  const md5 = (s: string) => createHash("md5").update(Buffer.from(s, "latin1")).digest();
  const key = md5(information.aesKey);
  const iv = information.aesIV.length ? md5(information.aesIV) : Buffer.alloc(16);

  // Pronote encrypts the next request number with the session key.
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  const order = Buffer.concat([cipher.update(String(information.order + 1), "utf8"), cipher.final()]).toString("hex");

  await fetch(`${information.url}/appeldeconnexion/${order}/${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ ns: information.id, no: order }),
  }).catch(() => {});
}

// ---- News details fetched by Pronote's own page ----

export type PageNewsQuestion = {
  title: string;
  html: string;
  attachments: Array<{ id: string; name: string; kind: number; url?: string }>;
  choices: string[];
  answered: boolean;
};

/** Details by newsKey(title, creation date): ids change every session, these don't. */
export const pageNews = new Map<string, { key: string; questions: PageNewsQuestion[] }>();
let knownNews = new Set<string>();

/** Keys whose details we already have (skipped at next login). */
export function setKnownNews(keys: Iterable<string>): void {
  knownNews = new Set(keys);
}

/**
 * Normalized title + creation day: the same on the page and in our list.
 * (The page holds titles HTML-escaped, e.g. &#39; for apostrophes.)
 */
export function newsKey(title: string, created: string | number | Date | null): string {
  const t = String(title ?? "").replace(/&#0*39;|&apos;|[’‘`´]/g, "'").replace(/&amp;/g, "&").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const d = created ? new Date(created) : null;
  return `${t}|${d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : ""}`;
}

/** Runs inside the Pronote page, with Pronote's own request classes. */
async function newsFromPage(known: string[]) {
  const req = (window as any).require;
  const R = req("objetrequetepageactualites.js");
  const TEN = req("typeensemblenombre.js");
  const items = (l: any): any[] => l?.ListeElements ?? (Array.isArray(l) ? l : []);
  // Same as newsKey() (functions can't be passed into the page).
  const keyOf = (a: any) => {
    const t = String(a.Libelle ?? "").replace(/&#0*39;|&apos;|[’‘`´]/g, "'").replace(/&amp;/g, "&").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
    const d = a.dateCreation ? new Date(a.dateCreation) : null;
    return `${t}|${d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : ""}`;
  };
  const skip = new Set(known);

  const modes = new TEN.TypeEnsembleNombre();
  modes.add(0);
  const list = await new R.ObjetRequetePageActualites(null).lancerRequete({ genreRequeteActualite: 0, modesAffActus: modes });
  const modesAff = list?.listeModesAff;
  const first = Array.isArray(modesAff) ? modesAff[0] : modesAff?.get?.(0) ?? items(modesAff)[0];

  const out = [];
  const errors: string[] = [];
  const all = items(first?.listeActualites);
  for (const actu of all.slice(0, 80)) {
    const key = keyOf(actu);
    if (skip.has(key)) continue;
    let det: any;
    try {
      det = await new R.ObjetRequetePageActualites(null).lancerRequete({ genreRequeteActualite: 1, modeAffActu: 0, actualite: actu });
    } catch (e: any) {
      errors.push(`${actu.Libelle}: ${e?.message ?? e}`);
      continue;
    }
    if (!det?.detailsActualite) {
      errors.push(`${actu.Libelle}: no details (${Object.keys(det ?? {}).join(",")})`);
      continue;
    }
    const questions = items(det?.detailsActualite?.listeQuestions).map((q: any) => ({
      title: q.titre || "",
      html: q.texte || "",
      attachments: items(q.listePiecesJointes).map((f: any) => ({ id: f.Numero, name: f.Libelle, kind: f.Genre ?? 1, url: f.url })),
      choices: items(q.listeChoix).map((c: any) => c.Libelle),
      answered: Boolean(q.reponse?.avecReponse),
    }));
    out.push({ key, questions });
  }
  return { items: out, errors, total: all.length };
}
