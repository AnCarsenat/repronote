import { createCipheriv, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright-core";
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
  lastActivity: number;
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

  await mkdir(BROWSER_PROFILE_DIR, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: !options.interactive,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    viewport: options.interactive ? null : { width: 420, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const captured = watchPronoteTraffic(page);

    // Look like a fresh browser to Pronote (its storage holds a navigator id
    // tied to earlier sessions). ENT cookies live on another origin and stay.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Storage.clearDataForOrigin", { origin: new URL(base).origin, storageTypes: "all" });
    await cdp.detach();

    await page.goto(`${base}/${SPACE_PAGE[kind]}?fd=1`);
    await waitUntilReady(page, captured, options.interactive);

    const frozen = await freezeWithRetry(page).catch(async (err) => {
      await page.screenshot({ path: `${BROWSER_PROFILE_DIR}/../last-error.png`, fullPage: true }).catch(() => {});
      throw err;
    });
    if (!captured.start) throw new Error("Did not see the Pronote page load (no Start(...) call).");
    if (!captured.instanceParameters) throw new Error("Did not capture FonctionParametres.");
    if (!captured.userParameters) throw new Error("Did not capture ParametresUtilisateur.");

    return await toPawnoteSession(base, kind, captured, frozen);
  } finally {
    await closeQuietly(context);
  }
}

function watchPronoteTraffic(page: Page): Captured {
  const captured: Captured = { userLoaded: false, pending: 0, lastActivity: Date.now() };
  const isApi = (url: string) => url.includes("/appelfonction/");

  page.on("request", (req) => {
    if (isApi(req.url())) {
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
  page.on("requestfailed", (req) => done(req.url()));

  page.on("response", async (res) => {
    const url = res.url();
    try {
      if (res.request().resourceType() === "document" && url.includes(".html")) {
        const match = (await res.text()).match(/Start\s*\(\s*(\{[^}]*\})/);
        if (match) captured.start = JSON.parse(match[1]);
      } else if (isApi(url)) {
        const body = JSON.parse(await res.text());
        const data = body.dataSec ?? body.donneesSec;
        if (typeof data === "string") {
          throw new Error("This Pronote server encrypts its traffic; not supported yet.");
        }
        if (body.id === "FonctionParametres" || body.nom === "FonctionParametres") {
          captured.instanceParameters = data?.data ?? data?.donnees;
        }
        if (body.id === "ParametresUtilisateur" || body.nom === "ParametresUtilisateur") {
          captured.userParameters = data?.data ?? data?.donnees;
          captured.userLoaded = true;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("not supported")) throw err;
      // Body unavailable (redirects etc.): ignore.
    } finally {
      done(url);
    }
  });

  return captured;
}

async function waitUntilReady(page: Page, captured: Captured, interactive: boolean): Promise<void> {
  const deadline = Date.now() + (interactive ? INTERACTIVE_TIMEOUT_MS : AUTO_LOGIN_TIMEOUT_MS);
  let closed = false;
  page.on("close", () => (closed = true));

  const submittedOn = new Set<string>();

  while (Date.now() < deadline) {
    if (closed) throw new Error("Browser window closed before login finished.");
    if (captured.userLoaded && captured.pending === 0 && Date.now() - captured.lastActivity > IDLE_MS) {
      return;
    }
    await submitAutofilledLogin(page, submittedOn).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!interactive) throw new InteractiveLoginRequired();
  throw new Error("Timed out waiting for login.");
}

/**
 * On the ENT login page, Chromium fills in the saved username/password but
 * nothing submits. If the password field is autofilled, press Enter in it
 * (once per page URL, so a wrong saved password can't loop).
 * Chromium hides autofilled values from page JS until a real interaction,
 * which is why we use the `:-webkit-autofill` pseudo-class and a real key press.
 */
async function submitAutofilledLogin(page: Page, submittedOn: Set<string>): Promise<void> {
  const url = page.url();
  if (url.includes("index-education.net") || submittedOn.has(url)) return;

  const password = page.locator("input[type=password]:-webkit-autofill").first();
  if ((await password.count()) === 0 || !(await password.isVisible())) return;

  submittedOn.add(url);
  await password.press("Enter");
}

/** The page may still be navigating or initialising: retry for a few seconds. */
async function freezeWithRetry(page: Page): Promise<FrozenCommunication> {
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

async function closeQuietly(context: BrowserContext): Promise<void> {
  await context.close().catch(() => {});
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
