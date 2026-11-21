// Desktop app: the local server runs inside Electron, the UI is a window on it,
// and Pronote/ENT logins use Electron's own browser windows (no Playwright).
import { join } from "node:path";
import { app, BrowserWindow, Notification, shell } from "electron";

// Data goes in the user profile (e.g. ~/.config/repronote/data, %APPDATA%\repronote\data).
// Must be set before the server module loads: it reads it at import time.
process.env.REPRONOTE_DATA_DIR ??= join(app.getPath("userData"), "data");
// Which download to offer when an update is out (see src/core/updates.ts).
process.env.REPRONOTE_PLATFORM ??=
  process.platform === "win32" ? "desktop-windows"
  : process.env.APPIMAGE ? "desktop-appimage"
  : process.platform === "linux" && app.getPath("exe").startsWith("/opt/") ? "desktop-deb"
  : process.platform === "linux" ? "desktop-linux"
  : process.platform === "darwin" ? "desktop-mac" : `desktop-${process.platform}`;

// Windows shows notifications only for apps with this id (the installer's appId).
if (process.platform === "win32") app.setAppUserModelId("io.github.ancarsenat.repronote");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Updates install themselves (src/electron/update.ts); data stays in userData.
const { setUpdateInstaller } = await import("../core/updates.ts");
const { desktopInstaller } = await import("./update.ts");
setUpdateInstaller(desktopInstaller);

const { setBrowserDriver } = await import("../core/browser-driver.ts");
const { electronDriver } = await import("./electron-driver.ts");
setBrowserDriver(electronDriver);

// New grades, homework… as system notifications; clicking one shows the app.
const { setSystemNotifier } = await import("../notify/notifications.ts");
setSystemNotifier((e) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: e.title, body: e.body });
  n.on("click", () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  n.show();
});

// Note: with an ES module main file, Electron emits "ready" only once this
// module has finished evaluating, so don't await app.whenReady() at top level.
app.whenReady().then(start).catch((err) => {
  console.error(err);
  app.exit(1);
});

let win: BrowserWindow | null = null;
let server: { port: number; stop(): Promise<void> };
let home = "";

async function start() {
  const { startServer } = await import("../server.ts");
  // Same port as `npm run serve` when free, otherwise any free port.
  try {
    server = await startServer({ port: 4173, host: "127.0.0.1" });
  } catch {
    server = await startServer({ port: 0, host: "127.0.0.1" });
  }
  home = `http://127.0.0.1:${server.port}`;
  createWindow();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 500,
    title: "repronote",
    autoHideMenuBar: true,
    backgroundColor: "#f4f4f8",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(home);

  // Our own pages (documents, PDFs) open in the app; everything else
  // (Pronote, links in news) in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(home)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 1000, height: 900 } };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(home)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on("closed", () => (win = null));
}

app.on("second-instance", () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

// macOS: re-open the window from the dock.
app.on("activate", () => !win && createWindow());
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());

// Log out of Pronote before quitting, so the next start isn't refused.
let stopping = false;
app.on("before-quit", (e) => {
  if (stopping) return;
  stopping = true;
  e.preventDefault();
  (server ? server.stop() : Promise.resolve()).finally(() => app.exit(0));
});
