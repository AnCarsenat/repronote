import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
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
