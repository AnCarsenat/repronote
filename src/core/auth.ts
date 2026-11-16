import type { SessionHandle } from "@blockshub/pawnote-lts";
import { InteractiveLoginRequired, openBrowserSession } from "./browser-session.ts";
import { loadConfig, saveConfig } from "./config.ts";

export { closeSession, InteractiveLoginRequired } from "./browser-session.ts";

/** Opens the login window, then saves the instance URL for later runs. */
export async function interactiveLogin(url?: string): Promise<SessionHandle> {
  url ??= (await loadConfig())?.url;
  if (!url) throw new Error("Not set up yet. Run `npm run login -- <pronote-url>` first.");
  const session = await openBrowserSession({ url, interactive: true });
  await saveConfig({ url: session.information.url });
  return session;
}

/**
 * Gets a Pronote session in the background using the saved ENT cookies.
 * If the ENT asks to log in again: opens the window when `allowWindow` is set
 * (CLI), otherwise throws InteractiveLoginRequired (background server sync).
 */
export async function getSession({ allowWindow = true } = {}): Promise<SessionHandle> {
  const config = await loadConfig();
  if (!config) throw new Error("Not set up yet. Run `npm run login -- <pronote-url>` first.");

  try {
    return await openBrowserSession({ url: config.url, interactive: false });
  } catch (err) {
    if (!(err instanceof InteractiveLoginRequired) || !allowWindow) throw err;
    console.error("ENT session expired: opening the login window...");
    return openBrowserSession({ url: config.url, interactive: true });
  }
}
