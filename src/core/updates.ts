import type { Store } from "../store/store.ts";
import { CHANNEL, PLATFORM, VERSION } from "./version.ts";

/**
 * "Is there a newer repronote?" — asks GitHub's public releases API (no
 * personal data sent, only the request itself), at start and twice a day,
 * unless turned off. Two channels:
 * - stable: the latest normal release (vX.Y.Z, from the main branch)
 * - dev: the rolling "dev" pre-release, rebuilt on every push to the dev branch
 * Nothing is installed by itself: the UI offers the right file for this platform.
 */
const REPO = "AnCarsenat/repronote";
const EVERY_MS = 12 * 3600_000;

export type UpdateSettings = { enabled: boolean; channel: "stable" | "dev" };
export type UpdateInfo = {
  checkedAt: number;
  current: string;
  channel: "stable" | "dev";
  platform: string;
  latest?: string;
  newer?: boolean;
  url?: string; // the file for this platform
  page?: string; // the release page
  notes?: string;
  publishedAt?: string;
  command?: string; // Linux server installed with install-linux.sh
  error?: string;
};

export function updateSettings(store: Store): UpdateSettings {
  const s = store.getSetting<Partial<UpdateSettings>>("updates") ?? {};
  return { enabled: s.enabled !== false, channel: s.channel === "dev" || s.channel === "stable" ? s.channel : CHANNEL };
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

function assetFor(assets: Array<{ name: string; browser_download_url: string }>): string | undefined {
  const find = (re: RegExp) => assets.find((a) => re.test(a.name))?.browser_download_url;
  switch (PLATFORM) {
    case "android": return find(new RegExp(`android-${ANDROID_ABI[process.env.REPRONOTE_ABI ?? process.arch] ?? "arm64-v8a"}\\.apk$`));
    case "desktop-windows": return find(/win-x64\.exe$/);
    case "desktop-appimage": return find(/\.AppImage$/);
    case "desktop-deb": return find(/\.deb$/);
    case "desktop-linux": return find(/linux-x64\.tar\.gz$/);
    default: return find(/^repronote-server-.*\.zip$/);
  }
}

let last: UpdateInfo | null = null;
let notified = "";

export const lastUpdateInfo = (store: Store): UpdateInfo | null => last ?? store.getSetting<UpdateInfo>("updateInfo");

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
    const release = settings.channel === "dev"
      ? releases.find((x) => !x.draft && x.prerelease && x.tag_name === "dev") ?? releases.find((x) => !x.draft && x.prerelease)
      : releases.find((x) => !x.draft && !x.prerelease);
    if (release) {
      // The rolling "dev" release names its version in its title ("Dev 0.4.0-dev.12").
      const latest = /\d+\.\d+\.\d+(?:-dev\.\d+)?/.exec(`${release.name ?? ""} ${release.tag_name}`)?.[0] ?? release.tag_name;
      Object.assign(info, {
        latest,
        newer: isNewer(latest, VERSION),
        url: assetFor(release.assets ?? []),
        page: release.html_url,
        notes: String(release.body ?? "").slice(0, 3000),
        publishedAt: release.published_at,
        command: PLATFORM === "server-installed"
          ? `curl -fsSL https://github.com/${REPO}/releases/${settings.channel === "dev" ? "download/dev" : "latest/download"}/install-linux.sh | bash -s -- --server${settings.channel === "dev" ? " --dev" : ""}`
          : undefined,
      });
    }
  } catch (err) {
    info.error = err instanceof Error ? err.message : String(err);
  }
  last = info;
  store.setSetting("updateInfo", info);
  return info;
}

/** Background checks; `onNew` is called once per newer version found. */
export function scheduleUpdateChecks(store: Store, onNew: (info: UpdateInfo) => void): () => void {
  const run = async () => {
    const info = await checkForUpdates(store);
    if (info?.newer && info.latest && info.latest !== notified && store.getSetting("updateNotified") !== info.latest) {
      notified = info.latest;
      store.setSetting("updateNotified", info.latest);
      onNew(info);
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
