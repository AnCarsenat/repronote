# Architecture

repronote is a **local server** (Node, TypeScript run directly by Node ≥ 24) that logs in to Pronote, keeps a local copy of the data, and serves a **web UI** (plain ES modules, no framework, no build step) plus a JSON API and an MCP endpoint. The same server runs in three shells:

| Shell | Entry point | Login browser | Data folder |
|---|---|---|---|
| Server (`npm run serve`, server zip, `install-linux.sh --server`) | `src/serve.ts` → `src/server.ts` | Playwright + system Chromium (`src/core/playwright-driver.ts`) | `REPRONOTE_DATA_DIR` or `./data` |
| Desktop app (Electron; AppImage, deb, exe) | `src/electron/main.ts` | Electron windows (`src/electron/electron-driver.ts`) | `~/.config/repronote/data`, `%APPDATA%\repronote\data` |
| Android app | `android/` (Java) runs `dist/android.mjs` from `src/android/main.ts` in nodejs-mobile (Node 18) | A second WebView driven over DevTools (`src/android/android-driver.ts`) | the app's files dir |

```
            ┌───────────── one process ─────────────┐
 ENT / CAS  │  BrowserDriver  ──►  browser-session   │       web/ (UI, ES modules)
  Pronote ◄─┤   (login page)       (session takeover)│◄────►  http://127.0.0.1:<port>
            │        │                               │       /api/*, /mcp
            │        ▼                               │
            │  pawnote session ──► sync.ts ──► Store │  SQLite (node:sqlite) or JSON (Node 18)
            │                         │              │
            │                         ▼              │
            │                  notify (diff, webhooks, system notifications)
            └────────────────────────────────────────┘
```

## Login: a real browser, then session takeover

Pronote 2026 broke token logins, so `src/core/browser-session.ts`:

1. opens the Pronote page in a browser through a `BrowserDriver` (`src/core/browser-driver.ts`: Playwright, Electron or Android implement the same interface);
2. lets the ENT/CAS log in: by itself when its cookies are valid, or in a visible window (`interactive`) where the user types the password (repronote never sees or stores it);
3. watches the page's Pronote traffic to capture the session (`Start(...)`, `FonctionParametres`, `ParametresUtilisateur`), runs a script in the page to read the AES key/IV and request counter, then **freezes** the page so it can't use the session again;
4. builds a pawnote `SessionHandle` from that (`toPawnoteSession`).

`src/core/live-session.ts` keeps that session open and reuses it (`live.use(fn, { interactive })`). The ENT's **session cookies** (Keycloak's `KEYCLOAK_IDENTITY`…) die when a browser closes; `src/core/session-cookies.ts` saves them when the login browser closes and restores them when it opens, so background logins keep working across restarts (the ENT still decides when to ask for the password again).

Background syncs never open a window: they throw `InteractiveLoginRequired`, and the UI shows « Se reconnecter ».

## Sync and store

- `src/store/sync.ts` (`syncAll`): fetches every kind (`user`, `timetable`, `homework`, `grades`, `news`, `notebook`, `documents`, `resources`, `account`…) with pawnote or raw requests (`src/core/raw-request.ts`) and stores each as a **snapshot** (`store.put(kind, data)`). Optional kinds may fail without failing the sync (`syncWarnings`).
- Pronote ids change every session: anything that must be recognized later uses a content key (`homeworkKey`, news keys, grade keys in `notify`).
- `homeworkArchive` keeps every homework ever seen (the snapshot covers a few weeks); `pending` queues actions made offline (ticking homework).
- `src/store/store.ts`: `Store.open()` uses `node:sqlite` when available, else a JSON file (Android's Node 18). Tables: snapshots, settings (layout, subject settings, notifications, plugins, update settings…), pending, sync log.
- `src/store/files.ts`: Pronote file links expire with the session, so attachments, casier documents and report cards are cached on first download (`data/files/`). `GET /api/documents.zip` (`documentsZip` in `server.ts`, `src/core/zip.ts`) bundles them all.

The server syncs at start, every 30 minutes, and on `POST /api/sync`.

## Notifications

After each sync, `src/notify/notifications.ts` diffs the snapshots before/after (`takeSnapshot`, `diff`) into events (`grade`, `homework`, `news`, `canceled`; nothing on the first sync) and `dispatch`es them to: webhooks (Discord embeds or JSON), the system notifier installed by the shell (`setSystemNotifier`: Electron `Notification`, Android through the bridge), and `recentEvents`, which the web UI turns into browser notifications when no system notifier exists (`web/notifications.js`).

## HTTP server (`src/server.ts`)

- Listens on **127.0.0.1** by default. `allowedRequest` rejects other Host headers (DNS rebinding) and cross-origin state-changing requests (CSRF). On Android it also requires the `repronote_token` cookie (`REPRONOTE_ACCESS_TOKEN`), because other apps can reach localhost.
- `GET /api` lists every route (keep `API_INDEX` in sync). `GET /api/state` returns everything the UI needs in one object.
- Static files come from `web/` (no cache, no build). Unknown paths without an extension get `index.html`.
- `POST /api/download` + `GET /api/download/:id`: generated files (PDF, HTML, ICS, CSV) are downloaded through the server because `blob:` downloads don't work in the Android WebView.
- `/mcp`: MCP over HTTP (`src/mcp/tools.ts`); `src/mcp/stdio.ts` is a stdio proxy for clients that launch a command.

## Updates (`src/core/updates.ts`, `src/core/version.ts`)

The version and channel are baked into bundles by esbuild (`scripts/build.mjs` reads `REPRONOTE_VERSION` / `REPRONOTE_CHANNEL` set by CI) and read from `package.json` when running from source. Each shell sets `REPRONOTE_PLATFORM` (`android`, `desktop-windows`, `desktop-appimage`, `desktop-deb`, `desktop-linux`, `server-installed`, `server`). The server asks GitHub's releases API at start and every 12 h (`stable`: latest normal release; `dev`: the rolling `dev` pre-release), picks the asset for the platform, and exposes the result in `/api/state.update`. Nothing installs itself: the UI (`web/updates.js`) shows a banner and the right download or command. See [releases.md](releases.md).

## Web UI (`web/`)

- `index.html` applies appearance settings before the first paint; `app.js` renders the header, tabs, banner and the current view on every state change (`subscribe`), and refreshes `/api/state` every minute.
- **Everything is re-rendered from scratch** (`h()` in `lib.js` builds DOM nodes; a view's `render(data, rerender)` returns nodes). Consequences, all handled in `app.js`: the scroll position is kept; the field being typed in keeps its value, focus and caret across the background refresh; a view can return the *same* nodes to keep them in place (sandboxed plugin frames would reload if moved).
- `state.js`: the client store, server calls, and debounced saves. Values shown but not yet saved (`unsaved`) are re-applied when a refresh arrives in between.
- `settings.js`: per-device preferences in localStorage (theme, accent, font, text size, density, colour-blind mode, tabs). Server-side settings (home layout, coefficients, notifications, plugins) go through the API.
- Tabs that don't fit go into « Plus » (`renderNav`/`fitNav` in `app.js`).
- Views: `web/views/*.js` (`{ id, title, render }`). Home widgets: `web/widgets/*.js` (see the README). Plugins page: `web/views/plugins.js` with built-in plugins in `web/plugins/` (calculators, shared timetable).
- `web/pdf.js`: a tiny PDF writer (rectangles + Helvetica text, cp1252) used for timetable exports. `web/md-editor.js`: the Markdown note editor (contenteditable, re-rendered on input with the caret restored by character offset).

### Community plugins and widgets (`web/plugins/github.js`, `web/plugins/sandbox.js`)

Found on GitHub by topic (`repronote-plugin`, `repronote-widget`), installed **pinned to a commit**, code stored as plugin data on the server. They run in `<iframe sandbox="allow-scripts">` (opaque origin) whose document has a CSP without network access; they receive only the data kinds their manifest lists (approved at install) via `postMessage`, and can save their own storage and offer downloads. Authoring guide: [plugins.md](plugins.md).

## Desktop (`src/electron/`)

`main.ts` sets the data dir and platform, installs the Electron login driver and the system notifier, starts the server (port 4173 or any free port) and opens a window on it. Links outside the app open in the system browser. Quitting logs out of Pronote first.

## Android (`android/`, `src/android/`)

- `NodeRunner.java` copies `assets/nodejs-project` (`dist/android.mjs` + `web/`, put there by Gradle) and starts Node with the environment (data dir, port, access token, bridge port/token).
- `MainActivity.java` shows the UI in a WebView with the access-token cookie, hosts login WebViews (hidden, or visible with an « Annuler » bar), handles downloads (`DownloadManager`), external links and notifications (`Notifications.java`).
- `Bridge.java`: a token-protected localhost TCP port. Mode `control`: JSON lines (open/close login WebViews, notify, events back). Mode `cdp`: piped to the WebViews' DevTools abstract socket, which Node 18 can't open itself. `src/android/bridge.ts` is the Node side (control channel, target list, a minimal WebSocket client for DevTools).

## Build and CI

`scripts/build.mjs` bundles `dist/server.mjs`, `dist/electron-main.mjs`, `dist/mcp.mjs`, `dist/android.mjs` (Node 18 target). `.github/workflows/build.yml` type-checks, builds the server zip, desktop apps, APKs, runs an Android emulator smoke test (real login on Pronote's demo site), and publishes releases. `.github/workflows/pages.yml` publishes the download pages. Details: [releases.md](releases.md).
