import * as pronote from "@blockshub/pawnote-lts";
import { closeSession, getSession, interactiveLogin } from "./auth.ts";

/**
 * Keeps one Pronote session open for the server, so actions (ticking
 * homework...) are instant instead of opening a browser each time.
 * Presence pings keep it alive; if Pronote drops it anyway, the next
 * call opens a new one and retries once.
 */
export class LiveSession {
  private session: pronote.SessionHandle | null = null;
  private opening: Promise<pronote.SessionHandle> | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  /** Runs `fn` with a working session, one call at a time. */
  use<T>(fn: (session: pronote.SessionHandle) => Promise<T>, { interactive = false, url }: { interactive?: boolean; url?: string } = {}): Promise<T> {
    const run = async () => {
      if (interactive) await this.reset();
      let session = await this.get(interactive, url);
      try {
        return await fn(session);
      } catch (err) {
        if (!isSessionError(err)) throw err;
        // Session died server-side: open a fresh one and retry once.
        await this.reset();
        session = await this.get(false);
        return fn(session);
      }
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => {});
    return result;
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  async reset(): Promise<void> {
    const old = this.session;
    this.session = null;
    if (old) {
      pronote.clearPresenceInterval(old);
      await closeSession(old);
    }
  }

  private async get(interactive: boolean, url?: string): Promise<pronote.SessionHandle> {
    if (this.session) return this.session;
    this.opening ??= (interactive ? interactiveLogin(url) : getSession({ allowWindow: false })).finally(
      () => (this.opening = null),
    );
    const session = await this.opening;
    pronote.startPresenceInterval(session);
    this.session = session;
    return session;
  }
}

function isSessionError(err: unknown): boolean {
  if (err instanceof pronote.SessionExpiredError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /session|déconnect|expir|PageUnavailable|connexion/i.test(message) && !/ENT wants you to log in/.test(message);
}
