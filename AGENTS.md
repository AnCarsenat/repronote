# Maintaining repronote — guide for AI agents (and humans)

Read this before changing anything. Then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit and [docs/releases.md](docs/releases.md) for branches and releases.

repronote is an alternative Pronote frontend: a local Node server that logs in through the school's ENT in a real browser, keeps the student's data on their own device, and serves a French web UI (also packaged as a desktop app and an Android app). Its users are students. **Their data is personal: privacy and security rules below are not optional.**

## Ground rules

1. **Privacy first.**
   - Data never leaves the device except to Pronote/the ENT, the optional GitHub update check, and what the user explicitly installs or shares.
   - Never add analytics, remote logging, CDNs or web fonts (the UI must work offline).
   - Never log or store passwords. The ENT password is typed by the user in the login window only.
   - Never put real student data in the repo, tests, screenshots or issues: use `node scripts/demo-data.mjs` (Camille Dupont, fake school).
2. **Keep the security model intact** (see "Security invariants").
3. **Branches:**
   - Work on `dev` (or a branch from `dev`).
   - `main` is stable and only gets `dev` merged when releasing, or a hotfix.
   - Commit, push, merge, tag or release **only when the maintainer asks**.
   - Never force-push `main` or `dev`.
4. **Small, readable code.**
   - No framework, no build step for the UI, few dependencies.
   - Every module starts with a comment saying what it is for. Comments explain *why*.
   - UI text is French; code, comments and docs for maintainers are English (user docs are French).
5. **Verify what you change, in the real UI** (see "Checks"), and say plainly what was and wasn't tested.

## Commands

| Command | |
|---|---|
| `npm install` | dependencies (Node ≥ 24; Chromium at `/usr/bin/chromium` or `CHROMIUM_PATH`) |
| `npm run typecheck` | TypeScript check. Run it after every change in `src/` |
| `for f in web/*.js web/*/*.js; do node --check "$f"; done` | syntax check of the UI modules (CI does the same) |
| `node scripts/demo-data.mjs /tmp/demo && REPRONOTE_DATA_DIR=/tmp/demo PORT=4180 npm run serve` | the app with fake data, no login, at http://localhost:4180 |
| `npm run serve` | the real server (needs a Pronote login: `npm run login -- <url>` or the UI's welcome screen) |
| `npm run build` | bundles in `dist/` (esbuild) |
| `npm run dist:linux` / `dist:win` / `dist:server` / `dist:android` | packages (Android needs the SDK + NDK; CI builds it) |
| `node scripts/screenshots.mjs http://localhost:4180 docs/screenshots` | README/site screenshots (demo data only) |

There is no unit test suite. Testing means:
- the type check;
- driving the UI with Playwright (`playwright-core` is a dependency; launch `/usr/bin/chromium`) against the demo server;
- for Android, the CI emulator job (`android-smoke`: installs the APK and logs in to Pronote's public demo).

Write throwaway test scripts in a scratch folder, not in the repo.

## Checks before saying "done"

- `npm run typecheck` passes and every `web/**/*.js` passes `node --check`.
- **UI changes:**
  - Load the page in the demo server.
  - Check for console errors.
  - Screenshot at desktop (1360 px) and phone (390 px, `isMobile`) widths, in light and dark themes if colours changed.
  - Look at the screenshots.
- **Interactions:**
  - Actually click/type them in Playwright.
  - For touch features, send touch events (CDP `Input.dispatchTouchEvent`).
- **Server routes:**
  - `curl` them on the demo server.
  - Add them to `API_INDEX` in `src/server.ts` and to the README's API table.
- **Login/sync changes:**
  - The maintainer's real account is the only real test.
  - Ask before running anything that logs in, and never open the login window without being asked.

## Security invariants

- The server listens on `127.0.0.1` by default. `allowedRequest` (server.ts) blocks foreign Host headers (DNS rebinding) and cross-origin non-GET requests (CSRF). Don't weaken it; new state-changing routes must not be GET.
- Android: other apps can reach localhost, so every request needs the `repronote_token` cookie, and the Java bridge needs its token. Keep both.
- Static files are served only from `web/` (path normalisation check). Uploaded/generated content goes through `/api/download/:id` with `Content-Disposition: attachment`.
- `cacheFromURL` only fetches URLs of the configured Pronote instance.
- Webhook URLs must be https (or http to localhost).
- **Community plugins/widgets are untrusted code.** They run only in `web/plugins/sandbox.js`. Never:
  - add `allow-same-origin` (or other sandbox flags);
  - loosen the iframe CSP (no network);
  - pass data kinds beyond the approved manifest permissions;
  - give them access to the API.

  They are pinned to a commit; updating them is the user's explicit action.
- The ENT session cookies (`data/ent-session-cookies.json`) and the Chromium profile are secrets: mode 0600/0700, never logged, never exported.
- The Android signing key (repository secrets) must never change or leak (see docs/releases.md).

## Traps (each one has bitten this project)

- **TypeScript is run directly by Node** (`erasableSyntaxOnly`):
  - no `enum`, no parameter properties (`constructor(private x)`), no `namespace`;
  - import with the `.ts` extension.
- **Android runs Node 18** (nodejs-mobile):
  - no `node:sqlite` (the store falls back to JSON);
  - no newer APIs in code reached by `dist/android.mjs`;
  - `zlib.crc32` doesn't exist (see `src/core/zip.ts`).
- **`h()` in `web/lib.js`** sets string values as *attributes*:
  - a `<textarea>`'s text must be a child (`h("textarea", {}, text)`), not `value`;
  - `null`/`false` children are skipped, arrays are flattened.
- **`replaceChildren(...)`** must get nodes. Passing `null` or an array renders the text "null" or "[object …]".
- **The whole view is re-rendered** on every state change and every minute:
  - keep transient UI state in module variables;
  - give inputs a stable `id` so `app.js` can restore focus/caret;
  - debounce server saves (`state.js` keeps unsaved values across refreshes);
  - never re-create an iframe you want to keep: return the same node.
- **CSS:**
  - `web/style.css` is one long file, and an unclosed `@media` block once made a whole section phone-only. Check braces after editing.
  - Later rules win: a generic `.segmented { display: … }` defined later overrode an earlier `.tt-span { display: none }`. Prefer more specific selectors to fix precedence.
- **Pronote ids change every session.** Match homework, news and grades by content keys, never by `id` across syncs.
- **The ENT keeps you logged in with session cookies.** Closing the login browser drops them; `session-cookies.ts` saves and restores them. Don't remove it.
- **Sandboxed environments** (like the one an agent may run in) can intercept HTTPS with their own CA: Node's `fetch` then fails with `SELF_SIGNED_CERT_IN_CHAIN` while `curl` works. Use `NODE_USE_SYSTEM_CA=1` for local testing; it is not a bug in the app.
- **Downloads:** `blob:` downloads don't work in the Android WebView. Use `downloadFile()` from `web/state.js` (goes through `/api/download`).
- **Mobile layout:** test at 390 px. The tab bar collapses into « Plus »; the timetable shows 1/3/5 days; widgets move by touch-dragging the ⋮⋮ grip.
- **Accessibility:**
  - Keep keyboard access (buttons, not clickable divs) and `aria-*` labels.
  - Respect `data-motion="reduce"`.
  - In colour-blind mode (`data-colorblind`), information must not rely on colour alone.

## Where things are

| Need | Look at |
|---|---|
| A new Pronote data kind | `src/store/sync.ts` (task), then a view in `web/views/` |
| A new API route | `src/server.ts` (route + `API_INDEX`), `web/state.js` (client call), README API table |
| A new page | `web/views/<name>.js` (`{ id, title, render }`), add it to `views` in `web/app.js` |
| A new home widget | `web/widgets/<name>.js`, list it in `web/widgets/index.js` |
| A new built-in plugin | `web/plugins/<name>.js` (`{ id, title, description, icon, render }`), list it in `web/plugins/index.js` |
| A per-device setting | `web/settings.js` (`DEFAULTS`, `applySettings`), `web/index.html` (first paint), `web/views/settings.js` (UI) |
| Notifications | `src/notify/notifications.ts`, `web/views/settings.js` (Notifications) |
| Login problems | `src/core/browser-session.ts`, `*-driver.ts`, `session-cookies.ts`; `REPRONOTE_DEBUG=1` prints login steps |
| Updates, versions | `src/core/updates.ts`, `src/core/version.ts`, `scripts/ci-version.mjs`, `web/updates.js` |
| CI, releases, pages | `.github/workflows/`, `docs/releases.md`, `site/index.html` |

## Writing style

- **User-facing text** (French): short, concrete and friendly.
  - Say what will happen and what to do.
  - No jargon ("synchronisation", "serveur local" are fine; "endpoint", "payload" are not).
- **Commit messages:** conventional style, for example `feat(web): …`, `fix(android): …`, `docs: …`. The body says why.
- **When reporting to the maintainer:**
  - What changed and what was verified, with the evidence (command output, screenshots).
  - What wasn't tested and what needs their action.
  - No overstatement.
