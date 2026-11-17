// Bundles the TypeScript sources for distribution:
//   dist/server.mjs         `node dist/server.mjs` — the standalone server
//   dist/electron-main.mjs  the desktop app's main process
//   dist/mcp.mjs            MCP over stdio for AI assistants (talks to a running server)
//   dist/android.mjs        the Android app's backend (embedded Node 18, see android/)
// The web UI (web/) needs no build: it is served as is, next to dist/.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// Version and release channel baked into the bundles (see src/core/version.ts).
// CI sets REPRONOTE_VERSION (e.g. 0.4.0-dev.12) and REPRONOTE_CHANNEL=dev for dev builds.
const version = process.env.REPRONOTE_VERSION || JSON.parse(readFileSync("package.json", "utf8")).version;
const channel = process.env.REPRONOTE_CHANNEL === "dev" || /-dev\./.test(version) ? "dev" : "stable";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  logLevel: "info",
  // Some dependencies use require(): give ESM bundles a working one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  // Playwright is only used by the server (and loaded lazily); Electron is provided by Electron.
  external: ["playwright-core", "electron"],
  define: { __REPRONOTE_VERSION__: JSON.stringify(version), __REPRONOTE_CHANNEL__: JSON.stringify(channel) },
};
console.log(`repronote ${version} (${channel})`);

await build({ ...common, entryPoints: ["src/serve.ts"], outfile: "dist/server.mjs" });
await build({ ...common, entryPoints: ["src/electron/main.ts"], outfile: "dist/electron-main.mjs" });
await build({ ...common, entryPoints: ["src/mcp/stdio.ts"], outfile: "dist/mcp.mjs" });
await build({ ...common, target: "node18", entryPoints: ["src/android/main.ts"], outfile: "dist/android.mjs" });
