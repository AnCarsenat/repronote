import type { SessionHandle } from "@blockshub/pawnote-lts";
import { InteractiveLoginRequired, openBrowserSession } from "./browser-session.ts";
export { closeSession } from "./browser-session.ts";
import { loadConfig, saveConfig } from "./config.ts";

/** Opens the login window, then saves the instance URL for later runs. */
export async function interactiveLogin(url: string): Promise<SessionHandle> {
  const session = await openBrowserSession({ url, interactive: true });
  await saveConfig({ url: session.information.url });
  return session;
}

/**
 * Gets a Pronote session for scripts: first in the background using the
 * saved ENT cookies, then with a visible window if the ENT asks to log in.
 */
export async function getSession(): Promise<SessionHandle> {
  const config = await loadConfig();
  if (!config) throw new Error("Not set up yet. Run `npm run login -- <pronote-url>` first.");

  try {
    return await openBrowserSession({ url: config.url, interactive: false });
  } catch (err) {
    if (!(err instanceof InteractiveLoginRequired)) throw err;
    console.error("ENT session expired: opening the login window...");
    return openBrowserSession({ url: config.url, interactive: true });
  }
}
