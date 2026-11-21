import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "../store/store.ts";
import { DATA_DIR } from "./config.ts";
import { CHANNEL, PLATFORM, VERSION } from "./version.ts";

/**
 * Updates: "is there a newer repronote?", and installing it.
 *
 * Checking asks GitHub's public releases API (no personal data sent, only the
 * request itself), at start and twice a day, unless turned off. Two channels:
 * - stable: the latest normal release (vX.Y.Z, from the main branch)
 * - dev: the highest of the rolling "dev" pre-release and the latest release
 *
 * Installing (automatic when `auto` is on, or on request): the file for this
 * platform is downloaded from GitHub into DATA_DIR/updates and checked against
 * the SHA-256 digest GitHub publishes for it; then the shell's installer (set
 * with setUpdateInstaller: server, desktop, Android) puts it in place and
 * restarts. Installers only replace the program, never the data folder.
 */
const REPO = "AnCarsenat/repronote";
const EVERY_MS = 12 * 3600_000;

export type UpdateSettings = { enabled: boolean; channel: "stable" | "dev"; auto: boolean };
export type UpdateAsset = { name: string; url: string; size: number; digest?: string };
export type InstallState = {
  state: "downloading" | "installing" | "waiting" | "error";
  version: string;
  message?: string;
  progress?: number; // 0..1 while downloading
  at: number;
};
export type UpdateInfo = {
  checkedAt: number;
  current: string;
  channel: "stable" | "dev";
  platform: string;
  latest?: string;
  newer?: boolean;
  url?: string; // the file for this platform
  asset?: UpdateAsset;
  page?: string; // the release page
  notes?: string;
  publishedAt?: string;
  command?: string; // Linux server installed with install-linux.sh
  /** Why this copy can't update itself (then the UI shows the manual way). */
  autoUnsupported?: string;
  install?: InstallState;
  error?: string;
};

/** What each shell provides to put a downloaded update in place. */
export type UpdateInstaller = {
  /** Why it can't install here (shown to the user), or null when it can. */
  unsupported(): string | null;
  /** Installs the downloaded, verified file. Usually ends with a restart. */
  install(file: string, info: UpdateInfo): Promise<void>;
};
let installer: UpdateInstaller | null = null;
export const setUpdateInstaller = (i: UpdateInstaller | null) => void (installer = i);
const unsupportedReason = () => (installer ? installer.unsupported() : "Mise à jour automatique indisponible sur cette installation.");

export function updateSettings(store: Store): UpdateSettings {
  const s = store.getSetting<Partial<UpdateSettings>>("updates") ?? {};
  return {
    enabled: s.enabled !== false,
    channel: s.channel === "dev" || s.channel === "stable" ? s.channel : CHANNEL,
    auto: s.auto !== false,
  };
}

/** "0.4.0" / "0.4.0-dev.12" -> comparable parts. */
function parse(v: string): number[] | null {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?/.exec(v);
  if (!m) return null;
  // A release is newer than any dev build of the same version.
  return [+m[1], +m[2], +m[3], m[4] === undefined ? Number.MAX_SAFE_INTEGER : +m[4]];
}
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const ANDROID_ABI: Record<string, string> = { arm64: "arm64-v8a", arm: "armeabi-v7a", x64: "x86_64", ia32: "x86_64" };

function assetFor(assets: any[]): UpdateAsset | undefined {
  const find = (re: RegExp) => {
    const a = assets.find((x) => re.test(x.name));
    return a ? { name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest ?? undefined } : undefined;
  };
  switch (PLATFORM) {
    case "android": return find(new RegExp(`android-${ANDROID_ABI[process.env.REPRONOTE_ABI ?? process.arch] ?? "arm64-v8a"}\\.apk$`));
    case "desktop-windows": return find(/win-x64\.exe$/);
    // An Intel build under Rosetta reports x64, so it is offered the Intel file again.
    case "desktop-mac": return find(new RegExp(`mac-${process.arch === "arm64" ? "arm64" : "x64"}\\.dmg$`));
    case "desktop-appimage": return find(/\.AppImage$/);
    case "desktop-deb": return find(/\.deb$/);
    case "desktop-linux": return find(/linux-x64\.tar\.gz$/);
    default: return find(/^repronote-server-.*\.zip$/);
  }
}

/** The release's version: the rolling "dev" release names it in its title ("Dev 0.4.0-dev.12"). */
const versionOf = (release: any): string =>
  /\d+\.\d+\.\d+(?:-dev\.\d+)?/.exec(`${release.name ?? ""} ${release.tag_name}`)?.[0] ?? release.tag_name;

let last: UpdateInfo | null = null;
let notified = "";
let installing: Promise<void> | null = null;

export const lastUpdateInfo = (store: Store): UpdateInfo | null => {
  const info = last ?? store.getSetting<UpdateInfo>("updateInfo");
  if (!info) return null;
  // Computed now: the installer is set by the shell after the last check may have been saved.
  const out = { ...info, autoUnsupported: unsupportedReason() ?? undefined };
  // After the restart this copy is the new version: the install is over.
  if (out.install && !isNewer(out.install.version, VERSION)) delete out.install;
  if (!isNewer(out.latest ?? "", VERSION)) out.newer = false;
  return out;
};

function save(store: Store, info: UpdateInfo) {
  last = info;
  store.setSetting("updateInfo", info);
}

export async function checkForUpdates(store: Store, { force = false } = {}): Promise<UpdateInfo | null> {
  const settings = updateSettings(store);
  if (!settings.enabled && !force) return lastUpdateInfo(store);
  const info: UpdateInfo = { checkedAt: Date.now(), current: VERSION, channel: settings.channel, platform: PLATFORM };
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "repronote-update-check" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
    const releases: any[] = await r.json();
    const stable = releases.find((x) => !x.draft && !x.prerelease);
    const dev = releases.find((x) => !x.draft && x.prerelease && x.tag_name === "dev") ?? releases.find((x) => !x.draft && x.prerelease);
    // Dev channel: whichever is highest (right after a release, it's the release).
    const release = settings.channel === "dev"
      ? [dev, stable].filter(Boolean).sort((a, b) => (isNewer(versionOf(a), versionOf(b)) ? -1 : 1))[0]
      : stable;
    if (release) {
      const latest = versionOf(release);
      const asset = assetFor(release.assets ?? []);
      Object.assign(info, {
        latest,
        newer: isNewer(latest, VERSION),
        asset,
        url: asset?.url,
        page: release.html_url,
        notes: String(release.body ?? "").slice(0, 3000),
        publishedAt: release.published_at,
        command: PLATFORM === "server-installed"
          ? `curl -fsSL https://github.com/${REPO}/releases/${release.prerelease ? "download/dev" : "latest/download"}/install-linux.sh | bash -s -- --server${release.prerelease ? " --dev" : ""}`
          : undefined,
      });
    }
  } catch (err) {
    info.error = err instanceof Error ? err.message : String(err);
  }
  // Keep showing an install in progress (or its error) for the same version.
  const previous = last ?? store.getSetting<UpdateInfo>("updateInfo");
  if (previous?.install && previous.install.version === info.latest) info.install = previous.install;
  save(store, info);
  return lastUpdateInfo(store);
}

function setInstall(store: Store, install: InstallState | undefined) {
  const info = last ?? store.getSetting<UpdateInfo>("updateInfo");
  if (info) save(store, { ...info, install });
}

/** GitHub serves release files from these hosts (after a redirect). */
const TRUSTED_HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com)$/;

/** Downloads the asset to DATA_DIR/updates and checks its SHA-256 against GitHub's digest. */
async function download(asset: UpdateAsset, onProgress: (p: number) => void): Promise<string> {
  const expected = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "")?.[1]?.toLowerCase();
  if (!expected) throw new Error("GitHub ne donne pas d'empreinte pour ce fichier : installez-le à la main.");
  if (!TRUSTED_HOSTS.test(new URL(asset.url).hostname)) throw new Error("Adresse de téléchargement inattendue.");
  const dir = join(DATA_DIR, "updates");
  await rm(dir, { recursive: true, force: true }); // older downloads
  await mkdir(dir, { recursive: true });
  const name = asset.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const file = join(dir, name);
  const r = await fetch(asset.url, { headers: { "User-Agent": "repronote-update" }, redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`Téléchargement refusé (${r.status}).`);
  if (!TRUSTED_HOSTS.test(new URL(r.url).hostname)) throw new Error("Redirection inattendue pendant le téléchargement.");
  const hash = createHash("sha256");
  const out = createWriteStream(`${file}.part`, { mode: 0o600 });
  let received = 0;
  let lastReport = 0;
  try {
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok));
      if (asset.size && Date.now() - lastReport > 500) {
        lastReport = Date.now();
        onProgress(Math.min(1, received / asset.size));
      }
    }
  } finally {
    await new Promise((ok) => out.end(ok));
  }
  if (hash.digest("hex") !== expected) {
    await rm(`${file}.part`, { force: true });
    throw new Error("Le fichier téléchargé ne correspond pas à l'empreinte publiée : mise à jour annulée.");
  }
  await rename(`${file}.part`, file);
  return file;
}

/**
 * Downloads and installs the newer version found by the last check.
 * `notify` tells the user what is happening (system notification).
 */
export function installUpdate(store: Store, notify: (title: string, body: string) => void): Promise<void> {
  installing ??= (async () => {
    const info = lastUpdateInfo(store);
    if (!info?.newer || !info.latest) throw new Error("Pas de nouvelle version à installer.");
    const version = info.latest;
    const reason = unsupportedReason();
    if (reason) throw new Error(reason);
    if (!info.asset) throw new Error("Pas de fichier pour cet appareil dans cette version.");
    try {
      notify(`Mise à jour de repronote vers ${version}`, "Téléchargement en cours… vos données sont conservées.");
      setInstall(store, { state: "downloading", version, progress: 0, at: Date.now() });
      const file = await download(info.asset, (progress) => setInstall(store, { state: "downloading", version, progress, at: Date.now() }));
      setInstall(store, { state: "installing", version, at: Date.now() });
      await installer!.install(file, info);
      // Still running: the installer waits for the user (Android) or restarts us shortly.
      setInstall(store, { state: "waiting", version, at: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInstall(store, { state: "error", version, message, at: Date.now() });
      store.setSetting("updateFailed", version); // no automatic retry for this version
      notify("La mise à jour de repronote a échoué", message);
      throw err;
    }
  })().finally(() => (installing = null));
  return installing;
}

/** Background checks; a newer version is announced once, and installed if `auto` is on. */
export function scheduleUpdateChecks(store: Store, notify: (title: string, body: string) => void): () => void {
  const run = async () => {
    const info = await checkForUpdates(store);
    if (!info?.newer || !info.latest) return;
    const settings = updateSettings(store);
    const canAuto = settings.auto && !info.autoUnsupported && store.getSetting("updateFailed") !== info.latest;
    if (canAuto) {
      await installUpdate(store, notify).catch(() => {});
    } else if (info.latest !== notified && store.getSetting("updateNotified") !== info.latest) {
      notified = info.latest;
      store.setSetting("updateNotified", info.latest);
      notify(`repronote ${info.latest} est disponible`, "Ouvrez repronote pour le télécharger.");
    }
  };
  const first = setTimeout(run, 20_000);
  const timer = setInterval(run, EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
