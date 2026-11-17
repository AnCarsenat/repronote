import { readFile, writeFile } from "node:fs/promises";
import { DATA_DIR } from "./config.ts";

/**
 * The ENT keeps you logged in with *session* cookies (e.g. Keycloak's
 * KEYCLOAK_IDENTITY), which a browser drops when it closes. We close the login
 * browser after every login, so without this the next background login would
 * hit the ENT's password page. Save them when the browser closes, put them back
 * when it opens: like a browser that never closed. The ENT still decides how
 * long its session lasts.
 */
export type SavedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

const FILE = `${DATA_DIR}ent-session-cookies.json`;
const MAX_AGE_MS = 7 * 24 * 3600_000;
// Pronote's own session must start fresh every time.
const skip = (domain: string) => /index-education\.net$/i.test(domain);

export async function loadSessionCookies(): Promise<SavedCookie[]> {
  try {
    const saved = JSON.parse(await readFile(FILE, "utf8"));
    if (!Array.isArray(saved?.cookies) || Date.now() - Number(saved.savedAt) > MAX_AGE_MS) return [];
    return saved.cookies.filter((c: SavedCookie) => c && typeof c.name === "string" && typeof c.domain === "string" && !skip(c.domain));
  } catch {
    return [];
  }
}

export async function saveSessionCookies(cookies: SavedCookie[]): Promise<void> {
  const kept = cookies.filter((c) => !skip(c.domain));
  await writeFile(FILE, JSON.stringify({ savedAt: Date.now(), cookies: kept }), { mode: 0o600 }).catch((err) =>
    console.error(`[login] could not save ENT session cookies: ${err instanceof Error ? err.message : err}`));
}
