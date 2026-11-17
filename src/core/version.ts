import { readFileSync } from "node:fs";

/**
 * This build's version and release channel. Bundles get them from esbuild
 * (scripts/build.mjs, REPRONOTE_CHANNEL at build time); running from source
 * reads package.json.
 */
declare const __REPRONOTE_VERSION__: string | undefined;
declare const __REPRONOTE_CHANNEL__: string | undefined;

function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

export const VERSION: string = typeof __REPRONOTE_VERSION__ === "string" ? __REPRONOTE_VERSION__ : packageVersion();
export const CHANNEL: "stable" | "dev" =
  (typeof __REPRONOTE_CHANNEL__ === "string" ? __REPRONOTE_CHANNEL__ : process.env.REPRONOTE_CHANNEL) === "dev" || /-dev\./.test(VERSION) ? "dev" : "stable";

/**
 * What this copy of repronote is, to offer the right download:
 * android | desktop-windows | desktop-appimage | desktop-deb | desktop-linux | server-installed | server
 * (set by the Android/desktop entry points and the Linux installer's launcher).
 */
export const PLATFORM: string = process.env.REPRONOTE_PLATFORM || "server";
