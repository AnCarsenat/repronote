import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";
import type { UpdateInstaller } from "../core/updates.ts";

/**
 * Self-update for the desktop app. The downloaded file (already checked
 * against GitHub's SHA-256) replaces the program only; the data lives in the
 * user profile (app.getPath("userData")) and is never touched.
 *
 * - Windows: the NSIS installer, silent (/S), over the old version, then it
 *   starts the app again (--force-run).
 * - macOS: the .app from the .dmg replaces this one, then it is reopened.
 * - AppImage: the new file replaces this one, then it is started.
 * - .deb: `pkexec dpkg -i` (the system asks for the password), then restart.
 * - .tar.gz: the extracted folder replaces this one, then it is started.
 * Replacing and restarting happen in a small shell script that waits for this
 * process to exit (files in use, single-instance lock).
 */
const writable = (path: string) => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Runs `script` (sh) once this process has exited, detached from it. */
function afterExit(script: string) {
  const wait = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done\n`;
  spawn("sh", ["-c", wait + script], { detached: true, stdio: "ignore" }).unref();
}

const macBundle = () => resolve(app.getPath("exe"), "../../..");
const exe = app.getPath("exe");

export const desktopInstaller: UpdateInstaller = {
  unsupported() {
    switch (process.env.REPRONOTE_PLATFORM) {
      case "desktop-windows":
        return null;
      case "desktop-mac": {
        const bundle = macBundle();
        if (!bundle.endsWith(".app")) return "Emplacement de l'application inattendu.";
        if (bundle.startsWith("/Volumes/")) return "Glissez d'abord repronote dans le dossier Applications.";
        return writable(dirname(bundle)) ? null : `Le dossier ${dirname(bundle)} n'est pas modifiable.`;
      }
      case "desktop-appimage": {
        const file = process.env.APPIMAGE;
        return file && writable(dirname(file)) && writable(file) ? null : "Le fichier AppImage n'est pas modifiable : remplacez-le à la main.";
      }
      case "desktop-deb":
        return has("pkexec") ? null : "Installez le nouveau paquet .deb à la main (pkexec absent).";
      case "desktop-linux":
        return writable(dirname(dirname(exe))) && writable(dirname(exe)) ? null : `Le dossier ${dirname(exe)} n'est pas modifiable.`;
      default:
        return "Mise à jour automatique indisponible sur ce système.";
    }
  },

  async install(file) {
    switch (process.env.REPRONOTE_PLATFORM) {
      case "desktop-windows": {
        // The installer closes the running app itself if needed; quit first anyway.
        spawn(file, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" }).unref();
        setTimeout(() => app.quit(), 300);
        return;
      }
      case "desktop-mac": {
        const bundle = macBundle();
        const mount = join(dirname(file), "mnt");
        await mkdir(mount, { recursive: true });
        const attach = spawnSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-quiet", "-mountpoint", mount, file]);
        if (attach.status !== 0) throw new Error("Impossible d'ouvrir le .dmg.");
        const inside = (await readdir(mount)).find((n) => n.endsWith(".app"));
        if (!inside) {
          spawnSync("hdiutil", ["detach", "-quiet", mount]);
          throw new Error("Pas d'application dans le .dmg.");
        }
        // Copy next to the old app first (same volume), then swap once we have quit.
        const staged = `${bundle}.new`;
        await rm(staged, { recursive: true, force: true });
        const copy = spawnSync("ditto", [join(mount, inside), staged]);
        spawnSync("hdiutil", ["detach", "-quiet", mount]);
        if (copy.status !== 0) throw new Error("Copie de la nouvelle version impossible.");
        spawnSync("xattr", ["-dr", "com.apple.quarantine", staged]);
        afterExit(`rm -rf ${q(`${bundle}.old`)} && mv ${q(bundle)} ${q(`${bundle}.old`)} && mv ${q(staged)} ${q(bundle)} && rm -rf ${q(`${bundle}.old`)}; open ${q(bundle)}`);
        setTimeout(() => app.quit(), 300);
        return;
      }
      case "desktop-appimage": {
        const target = process.env.APPIMAGE!;
        const staged = `${target}.new`;
        await copyFile(file, staged);
        await chmod(staged, 0o755);
        await rename(staged, target); // the running copy keeps its old file open
        afterExit(`nohup ${q(target)} >/dev/null 2>&1 &`);
        setTimeout(() => app.quit(), 300);
        return;
      }
      case "desktop-deb": {
        const r = spawnSync("pkexec", ["dpkg", "-i", file], { stdio: "inherit" });
        if (r.status !== 0) throw new Error("Installation du paquet annulée ou refusée.");
        afterExit(`nohup ${q(exe)} >/dev/null 2>&1 &`);
        setTimeout(() => app.quit(), 300);
        return;
      }
      case "desktop-linux": {
        const dir = dirname(exe);
        const staged = `${dir}.new`;
        await rm(staged, { recursive: true, force: true });
        await mkdir(staged, { recursive: true });
        const tar = spawnSync("tar", ["-xzf", file, "-C", staged]);
        if (tar.status !== 0) throw new Error("Archive illisible.");
        // The archive holds one folder: use what's inside it.
        const items = await readdir(staged);
        const from = items.length === 1 && !existsSync(join(staged, "resources")) ? join(staged, items[0]) : staged;
        afterExit(`rm -rf ${q(`${dir}.old`)} && mv ${q(dir)} ${q(`${dir}.old`)} && mv ${q(from)} ${q(dir)} && rm -rf ${q(`${dir}.old`)} ${q(staged)}; nohup ${q(join(dir, "repronote"))} >/dev/null 2>&1 &`);
        setTimeout(() => app.quit(), 300);
        return;
      }
      default:
        throw new Error("Mise à jour automatique indisponible sur ce système.");
    }
  },
};
