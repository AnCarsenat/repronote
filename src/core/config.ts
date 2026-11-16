import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where everything is stored: REPRONOTE_DATA_DIR (the desktop app points it at
 * the user profile), else ./data in the folder the server is started from.
 */
export const DATA_DIR = join(process.env.REPRONOTE_DATA_DIR ?? join(process.cwd(), "data"), "/");
/** Chromium profile: keeps the ENT/CAS cookies so later logins can be automatic. */
export const BROWSER_PROFILE_DIR = `${DATA_DIR}browser-profile`;
const CONFIG_PATH = `${DATA_DIR}config.json`;

export type Config = {
  /** Pronote instance URL, e.g. https://0000000a.index-education.net/pronote */
  url: string;
};

export async function loadConfig(): Promise<Config | null> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await chmod(DATA_DIR, 0o700);
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
