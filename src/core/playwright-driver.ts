import { mkdir, writeFile } from "node:fs/promises";
import type { BrowserDriver, DriverPage } from "./browser-driver.ts";

/** Playwright + the system's Chromium, with a persistent profile. */
export const playwrightDriver: BrowserDriver = {
  async openPage({ interactive, profileDir }) {
    const { chromium } = await import("playwright-core");
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: !interactive,
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      viewport: interactive ? null : { width: 420, height: 900 },
    });
    const page = await context.newPage();
    for (const other of context.pages()) if (other !== page) await other.close().catch(() => {});
    const submittedOn = new Set<string>();

    const driverPage: DriverPage = {
      async goto(url) {
        await page.goto(url);
      },
      url: () => page.url(),
      evaluate: (fn, arg) => page.evaluate(fn as any, arg as any),
      onRequest: (cb) => page.on("request", (req) => cb(req.url())),
      onRequestFailed: (cb) => page.on("requestfailed", (req) => cb(req.url(), req.failure()?.errorText ?? "")),
      onResponse: (cb) =>
        page.on("response", (res) =>
          cb({
            url: res.url(),
            isDocument: res.request().resourceType() === "document",
            status: res.status(),
            text: () => res.text(),
          }),
        ),
      onClose: (cb) => page.on("close", cb),
      async clearOriginData(origin) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
        await cdp.detach();
      },
      /**
       * On the ENT login page, Chromium fills in the saved username/password but
       * nothing submits. Chromium hides autofilled values from page scripts until a
       * real interaction, so we look for `:-webkit-autofill` and press Enter (once
       * per page URL, so a wrong saved password can't loop).
       */
      async submitAutofilledLogin() {
        const url = page.url();
        if (url.includes("index-education.net") || submittedOn.has(url)) return false;
        const password = page.locator("input[type=password]:-webkit-autofill").first();
        if ((await password.count()) === 0 || !(await password.isVisible())) return false;
        submittedOn.add(url);
        await password.press("Enter");
        return true;
      },
      async screenshot(path) {
        await writeFile(path, await page.screenshot({ fullPage: true }));
      },
      async close() {
        await context.close().catch(() => {});
      },
    };
    return driverPage;
  },
};
