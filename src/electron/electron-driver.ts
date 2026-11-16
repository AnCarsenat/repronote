import { writeFile } from "node:fs/promises";
import { BrowserWindow, session as electronSession } from "electron";
import type { BrowserDriver, DriverPage, DriverResponse } from "../core/browser-driver.ts";

/**
 * Login through Electron's own browser windows (no Playwright, no system
 * Chromium). Traffic is watched with the Chrome DevTools Protocol through
 * webContents.debugger. Cookies (the ENT session) persist in a named partition.
 */
const PARTITION = "persist:pronote-login";

export const electronDriver: BrowserDriver = {
  async openPage({ interactive }) {
    const win = new BrowserWindow({
      show: interactive,
      width: 520,
      height: 820,
      title: "Connexion à Pronote",
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
    });
    const wc = win.webContents;
    // A page must exist before DevTools commands are answered.
    await wc.loadURL("about:blank");
    const dbg = wc.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("Network.enable");
    await dbg.sendCommand("Page.enable");

    const requestCbs: Array<(url: string) => void> = [];
    const failedCbs: Array<(url: string, error: string) => void> = [];
    const responseCbs: Array<(r: DriverResponse) => void> = [];
    const closeCbs: Array<() => void> = [];
    const pending = new Map<string, { url: string; isDocument: boolean; status: number }>();

    dbg.on("message", (_e, method, params: any) => {
      if (method === "Network.requestWillBeSent") {
        for (const cb of requestCbs) cb(params.request.url);
      } else if (method === "Network.responseReceived") {
        pending.set(params.requestId, { url: params.response.url, isDocument: params.type === "Document", status: params.response.status });
      } else if (method === "Network.loadingFinished") {
        const meta = pending.get(params.requestId);
        pending.delete(params.requestId);
        if (!meta) return;
        const text = async () => {
          const r: any = await dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId });
          return r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
        };
        for (const cb of responseCbs) cb({ ...meta, text });
      } else if (method === "Network.loadingFailed") {
        const url = pending.get(params.requestId)?.url ?? "";
        pending.delete(params.requestId);
        for (const cb of failedCbs) cb(url, params.errorText ?? "");
      }
    });
    win.on("closed", () => closeCbs.forEach((cb) => cb()));

    const page: DriverPage = {
      async goto(url) {
        // Redirects (ENT/CAS) can abort the first load: that's fine.
        await wc.loadURL(url).catch(() => {});
      },
      url: () => (win.isDestroyed() ? "" : wc.getURL()),
      async evaluate(fn, arg) {
        return wc.executeJavaScript(`(${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`, true);
      },
      onRequest: (cb) => requestCbs.push(cb),
      onRequestFailed: (cb) => failedCbs.push(cb),
      onResponse: (cb) => responseCbs.push(cb),
      onClose: (cb) => closeCbs.push(cb),
      async clearOriginData(origin) {
        await electronSession.fromPartition(PARTITION).clearStorageData({ origin });
      },
      // Electron has no password manager: the user types the ENT password when asked.
      submitAutofilledLogin: async () => false,
      async screenshot(path) {
        if (!win.isDestroyed()) await writeFile(path, (await wc.capturePage()).toPNG());
      },
      async close() {
        if (win.isDestroyed()) return;
        try {
          dbg.detach();
        } catch {}
        win.destroy();
      },
    };
    return page;
  },
};
