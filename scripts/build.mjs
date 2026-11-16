// Bundles the TypeScript sources for distribution:
//   dist/server.mjs         `node dist/server.mjs` — the standalone server
//   dist/electron-main.mjs  the desktop app's main process
//   dist/mcp.mjs            MCP over stdio for AI assistants (talks to a running server)
//   dist/android.mjs        the Android app's backend (embedded Node 18, see android/)
// The web UI (web/) needs no build: it is served as is, next to dist/.
import { build } from "esbuild";

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
};

await build({ ...common, entryPoints: ["src/serve.ts"], outfile: "dist/server.mjs" });
await build({ ...common, entryPoints: ["src/electron/main.ts"], outfile: "dist/electron-main.mjs" });
await build({ ...common, entryPoints: ["src/mcp/stdio.ts"], outfile: "dist/mcp.mjs" });
await build({ ...common, target: "node18", entryPoints: ["src/android/main.ts"], outfile: "dist/android.mjs" });
