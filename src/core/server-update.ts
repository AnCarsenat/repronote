import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzip } from "./unzip.ts";
import type { UpdateInstaller } from "./updates.ts";

/**
 * Self-update for the standalone server (server zip, or install-linux.sh
 * --server): replaces the program files in place from the release zip, keeps
 * everything else (node_modules, and the data folder, which is elsewhere or in
 * ./data), then restarts the process.
 *
 * Restart: under systemd (the --autostart service, Restart=on-failure) we exit
 * with a non-zero code and systemd starts the new version; otherwise we start
 * a detached copy of ourselves (same command, environment and output) once our
 * port is free, and record its pid where the launcher expects it.
 */
const here = fileURLToPath(import.meta.url);
// Bundled: <root>/dist/server.mjs. From source (src/core/*.ts): not updatable.
const bundled = here.endsWith(".mjs");
const root = resolve(dirname(here), "..");
/** What a release zip may replace; anything else in the folder is left alone. */
const PROGRAM = ["dist", "web", "package.json", "README.md", "LICENSE"];

const writable = (path: string) => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

export function serverInstaller(stop: () => Promise<void>): UpdateInstaller {
  return {
    unsupported() {
      if (!bundled) return "repronote tourne depuis le code source : mettez-le à jour avec « git pull ».";
      if (existsSync(join(root, ".git"))) return "Ce dossier est un dépôt git : mettez-le à jour avec « git pull ».";
      if (![root, join(root, "dist"), join(root, "web")].every(writable)) {
        return `Le dossier ${root} n'est pas modifiable par repronote : relancez l'installation une fois (repronote-server --update), les suivantes seront automatiques.`;
      }
      return null;
    },

    async install(file) {
      const entries = unzip(await readFile(file));
      // The zip holds one folder (repronote-server/): strip it.
      const top = entries[0]?.name.split("/")[0] + "/";
      const strip = entries.every((e) => e.name.startsWith(top)) ? top.length : 0;
      const fresh = join(root, ".update-new");
      const old = join(root, ".update-old");
      await rm(fresh, { recursive: true, force: true });
      await rm(old, { recursive: true, force: true });
      for (const e of entries) {
        const name = e.name.slice(strip);
        if (!name || !PROGRAM.includes(name.split("/")[0])) continue;
        const target = join(fresh, name);
        if (e.dir) await mkdir(target, { recursive: true });
        else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, e.data, { mode: e.mode ?? 0o644 });
        }
      }
      if (!existsSync(join(fresh, "dist", "server.mjs"))) throw new Error("Archive inattendue : pas de dist/server.mjs.");

      const deps = (dir: string) => {
        try {
          return JSON.stringify(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies ?? {});
        } catch {
          return "";
        }
      };
      const depsChanged = deps(fresh) !== deps(root);

      // Swap item by item; on failure put the old files back.
      await mkdir(old, { recursive: true });
      const moved: string[] = [];
      try {
        for (const item of PROGRAM) {
          if (!existsSync(join(fresh, item))) continue;
          if (existsSync(join(root, item))) await rename(join(root, item), join(old, item));
          moved.push(item);
          await rename(join(fresh, item), join(root, item));
        }
        if (depsChanged) {
          const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
          if (npm.status !== 0) throw new Error("npm install a échoué.");
        }
      } catch (err) {
        for (const item of moved) {
          await rm(join(root, item), { recursive: true, force: true }).catch(() => {});
          if (existsSync(join(old, item))) await rename(join(old, item), join(root, item)).catch(() => {});
        }
        throw err;
      }
      await rm(fresh, { recursive: true, force: true });
      await rm(old, { recursive: true, force: true });
      await rm(file, { force: true });
      setTimeout(() => void restart(stop), 500); // let the HTTP answer go out first
    },
  };
}

/**
 * Started by a systemd service (install-linux.sh --autostart)? Not INVOCATION_ID
 * or the parent process: terminals started by systemd pass INVOCATION_ID on, and
 * a backgrounded server is re-parented to `systemd --user`. systemd sets
 * SYSTEMD_EXEC_PID to the service's own process (the launcher execs node).
 */
function supervisedBySystemd(): boolean {
  return process.env.REPRONOTE_SUPERVISED === "systemd" || process.env.SYSTEMD_EXEC_PID === String(process.pid);
}

async function restart(stop: () => Promise<void>) {
  console.log("[update] restarting on the new version");
  await stop().catch(() => {});
  if (supervisedBySystemd()) process.exit(75); // Restart=on-failure starts the new version
  const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: "inherit", env: process.env, cwd: process.cwd() });
  child.unref();
  if (process.env.REPRONOTE_PID_FILE && child.pid) await writeFile(process.env.REPRONOTE_PID_FILE, `${child.pid}\n`).catch(() => {});
  process.exit(0);
}
