import * as pronote from "@blockshub/pawnote-lts";
import { closeSession, interactiveLogin } from "../core/auth.ts";
import { loadConfig } from "../core/config.ts";

// URL from the command line, else the one saved from the last login.
const url = process.argv[2] ?? (await loadConfig())?.url;

if (!url) {
  console.error("Usage: npm run login -- https://XXXXXXXX.index-education.net/pronote/");
  process.exit(1);
}

console.log("A browser window will open. Log in there (ENT or Pronote); it closes by itself.");
let session: pronote.SessionHandle | undefined;
try {
  session = await interactiveLogin(url);

  // One real request through pawnote, to prove the session handoff works.
  const now = new Date();
  const week = await pronote.assignmentsFromIntervals(session, now, new Date(now.getTime() + 7 * 864e5));

  console.log(`Logged in as ${session.user.name} (${session.user.resources[0]?.className ?? "?"}).`);
  console.log(`Session works: ${week.length} homework item(s) in the next 7 days.`);
  console.log("Later runs reuse your ENT session in the background.");
} catch (err) {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  if (session) await closeSession(session);
}
