import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DATA_DIR, loadConfig } from "../core/config.ts";

/**
 * Local copies of Pronote files (attachments, documents, report cards).
 * Pronote links die with the session that made them, so files are saved the
 * first time they're fetched and served from disk afterwards (offline too).
 */
const FILES_DIR = `${DATA_DIR}files/`;
const pathOf = (key: string) => `${FILES_DIR}${createHash("sha256").update(key).digest("hex")}`;

export type CachedFile = { body: Buffer; type: string };

export async function readCached(key: string): Promise<CachedFile | null> {
  const body = await readFile(pathOf(key)).catch(() => null);
  if (!body) return null;
  const type = (await readFile(`${pathOf(key)}.type`, "utf8").catch(() => null)) ?? "application/octet-stream";
  return { body, type };
}

/** Downloads a Pronote URL into the cache. Only URLs of the configured instance. */
export async function cacheFromURL(key: string, url: string): Promise<CachedFile | null> {
  const base = (await loadConfig())?.url;
  if (!base || !url.startsWith(`${base}/`)) return null;
  const r = await fetch(url);
  const type = r.headers.get("content-type") ?? "application/octet-stream";
  if (!r.ok || type.startsWith("text/html")) return null;
  const body = Buffer.from(await r.arrayBuffer());
  await mkdir(FILES_DIR, { recursive: true, mode: 0o700 });
  await writeFile(pathOf(key), body);
  await writeFile(`${pathOf(key)}.type`, type);
  return { body, type };
}
