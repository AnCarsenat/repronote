import * as pronote from "@blockshub/pawnote-lts";
import { closeSession, getSession } from "../core/auth.ts";

const DAYS_AHEAD = Number(process.argv[2] ?? 14);

const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .trim();

let session: pronote.SessionHandle | undefined;
try {
  session = await getSession();

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + DAYS_AHEAD);

  const assignments = await pronote.assignmentsFromIntervals(session, start, end);
  assignments.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  if (assignments.length === 0) console.log(`No homework in the next ${DAYS_AHEAD} days.`);

  let lastDay = "";
  for (const a of assignments) {
    const day = a.deadline.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (day !== lastDay) {
      console.log(`\n=== ${day} ===`);
      lastDay = day;
    }
    console.log(`${a.done ? "[x]" : "[ ]"} ${a.subject.name}`);
    for (const line of stripHtml(a.description).split("\n")) console.log(`    ${line}`);
    for (const file of a.attachments) console.log(`    📎 ${file.name} ${file.url}`);
  }
} catch (err) {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  if (session) await closeSession(session);
}
