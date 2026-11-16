import { writeFile } from "node:fs/promises";
import type { BrowserDriver, DriverPage, DriverResponse } from "../core/browser-driver.ts";
import { CdpSession, Control, listTargets } from "./bridge.ts";

/**
 * Login through Android WebViews. The app (Java) creates the WebView when we
 * ask over the control channel; we then drive it with the DevTools protocol,
 * like the Electron driver does. Cookies (the ENT session) persist in the
 * app's WebView cookie store.
 */
const control = new Control();
const waiters = new Map<string, () => void>();
const closeCbsById = new Map<number, Array<() => void>>();

control.on("event", (e: { event: string; id: number }) => {
  waiters.get(`${e.event}:${e.id}`)?.();
  if (e.event === "closed") closeCbsById.get(e.id)?.forEach((cb) => cb());
});

function waitFor(event: string, id: number, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = `${event}:${id}`;
    const timer = setTimeout(() => {
      waiters.delete(key);
      reject(new Error(`Android app did not answer (${event})`));
    }, ms);
    waiters.set(key, () => {
      clearTimeout(timer);
      waiters.delete(key);
      resolve();
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;

export const androidDriver: BrowserDriver = {
  async openPage(options) {
    try {
      return await openPage(options);
    } catch (err) {
      console.error(`[android-driver] ${err instanceof Error ? err.stack : err}`);
      throw err;
    }
  },
};

async function openPage({ interactive }: { interactive: boolean }): Promise<DriverPage> {
    const id = nextId++;
    console.log(`[android-driver] open ${id} interactive=${interactive}`);
    const opened = waitFor("opened", id, 15_000);
    await control.send({ cmd: "open", id, interactive });
    await opened;

    // Find the new WebView among the DevTools targets by its marker title.
    const title = `repronote-login-${id}`;
    let targetId: string | undefined;
    for (let i = 0; i < 50 && !targetId; i++) {
      targetId = (await listTargets()).find((t) => t.title === title)?.id;
      if (!targetId) await sleep(100);
    }
    console.log(`[android-driver] target ${title}: ${targetId ?? "not found"}`);
    if (!targetId) {
      await control.send({ cmd: "close", id });
      throw new Error("Login WebView not found in DevTools targets");
    }

    const cdp = await CdpSession.attach(targetId);
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");

    const requestCbs: Array<(url: string) => void> = [];
    const failedCbs: Array<(url: string, error: string) => void> = [];
    const responseCbs: Array<(r: DriverResponse) => void> = [];
    const closeCbs: Array<() => void> = [];
    closeCbsById.set(id, closeCbs);
    const pending = new Map<string, { url: string; isDocument: boolean; status: number }>();
    let currentURL = "about:blank";
    let loadWaiter: (() => void) | null = null;
    let closed = false;

    cdp.on("event", (method: string, params: any) => {
      if (method === "Network.requestWillBeSent") {
        for (const cb of requestCbs) cb(params.request.url);
      } else if (method === "Network.responseReceived") {
        pending.set(params.requestId, { url: params.response.url, isDocument: params.type === "Document", status: params.response.status });
      } else if (method === "Network.loadingFinished") {
        const meta = pending.get(params.requestId);
        pending.delete(params.requestId);
        if (!meta) return;
        const text = async () => {
          const r: any = await cdp.send("Network.getResponseBody", { requestId: params.requestId });
          return r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
        };
        for (const cb of responseCbs) cb({ ...meta, text });
      } else if (method === "Network.loadingFailed") {
        const url = pending.get(params.requestId)?.url ?? "";
        pending.delete(params.requestId);
        for (const cb of failedCbs) cb(url, params.errorText ?? "");
      } else if (method === "Page.frameNavigated") {
        if (!params.frame.parentId) currentURL = params.frame.url + (params.frame.urlFragment ?? "");
      } else if (method === "Page.navigatedWithinDocument") {
        currentURL = params.url;
      } else if (method === "Page.loadEventFired") {
        loadWaiter?.();
      }
    });
    const onClosed = () => {
      if (closed) return;
      closed = true;
      closeCbs.forEach((cb) => cb());
    };
    cdp.on("close", onClosed);
    closeCbs.push(() => (closed = true));

    const page: DriverPage = {
      async goto(url) {
        const loaded = new Promise<void>((resolve) => {
          loadWaiter = resolve;
          setTimeout(resolve, 30_000);
        });
        // Redirects (ENT/CAS) can abort the first load: that's fine.
        await cdp.send("Page.navigate", { url }).catch(() => {});
        await loaded;
        loadWaiter = null;
      },
      url: () => (closed ? "" : currentURL),
      async evaluate(fn, arg) {
        const expression = `(${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`;
        const r: any = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      onRequest: (cb) => requestCbs.push(cb),
      onRequestFailed: (cb) => failedCbs.push(cb),
      onResponse: (cb) => responseCbs.push(cb),
      onClose: (cb) => closeCbs.push(cb),
      async clearOriginData(origin) {
        await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" }).catch(() => {});
      },
      // The WebView has no password manager: the user types the ENT password when asked.
      submitAutofilledLogin: async () => false,
      async screenshot(path) {
        const r: any = await cdp.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path, Buffer.from(r.data, "base64"));
      },
      async close() {
        cdp.close();
        closeCbsById.delete(id);
        await control.send({ cmd: "close", id }).catch(() => {});
      },
    };
    return page;
}
