/**
 * The login needs a real browser we can drive: open the Pronote page, watch
 * its traffic, run scripts in it. Two implementations:
 * - Playwright + system Chromium (Node server, CLI) — playwright-driver.ts
 * - Electron's own browser windows (desktop app) — electron/electron-driver.ts
 */

export type DriverResponse = {
  url: string;
  /** Top-level page (HTML document), as opposed to XHR/fetch/scripts. */
  isDocument: boolean;
  status: number;
  text(): Promise<string>;
};

export interface DriverPage {
  goto(url: string): Promise<void>;
  url(): string;
  /** Runs `fn` inside the page (it must not use outside variables). */
  evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
  onRequest(cb: (url: string) => void): void;
  onRequestFailed(cb: (url: string, error: string) => void): void;
  onResponse(cb: (r: DriverResponse) => void): void;
  onClose(cb: () => void): void;
  /** Forget a site's storage and cookies (not the ENT's, which is another origin). */
  clearOriginData(origin: string): Promise<void>;
  /** Submits a login form the browser filled in by itself. Returns true if it did. */
  submitAutofilledLogin(): Promise<boolean>;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  /** A new page in a persistent profile (ENT cookies survive between runs). */
  openPage(options: { interactive: boolean; profileDir: string }): Promise<DriverPage>;
}

let current: BrowserDriver | null = null;

/** The desktop app installs its Electron driver at startup. */
export function setBrowserDriver(driver: BrowserDriver): void {
  current = driver;
}

export async function getBrowserDriver(): Promise<BrowserDriver> {
  if (!current) current = (await import("./playwright-driver.ts")).playwrightDriver;
  return current;
}
