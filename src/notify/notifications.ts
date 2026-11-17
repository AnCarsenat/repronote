import type { Store } from "../store/store.ts";
import { homeworkKey } from "../store/sync.ts";

/**
 * Notifications: after each sync, what changed (new grades, homework, news,
 * canceled classes) becomes events, sent to
 * - webhooks (Discord, or plain JSON for anything else: ntfy, Home Assistant, n8n…)
 * - the system (desktop/Android app), through a notifier the app installs
 * - the web UI, which keeps a short list and can show browser notifications.
 */

export type EventKind = "grade" | "homework" | "news" | "canceled";

export type NotifyEvent = {
  id: string;
  kind: EventKind;
  title: string;
  body: string;
  at: number;
};

export type Webhook = { id: string; url: string; format: "discord" | "json"; name?: string };

export type NotificationSettings = {
  kinds: Record<EventKind, boolean>;
  /** System notifications (desktop/Android app) or browser notifications (UI). */
  system: boolean;
  webhooks: Webhook[];
};

export const KIND_LABELS: Record<EventKind, string> = {
  grade: "Nouvelle note",
  homework: "Nouveau devoir",
  news: "Nouvelle information",
  canceled: "Cours annulé",
};

export const DEFAULT_SETTINGS: NotificationSettings = {
  kinds: { grade: true, homework: true, news: true, canceled: true },
  system: true,
  webhooks: [],
};

export function getSettings(store: Store): NotificationSettings {
  const s = store.getSetting<Partial<NotificationSettings>>("notifications") ?? {};
  return { ...DEFAULT_SETTINGS, ...s, kinds: { ...DEFAULT_SETTINGS.kinds, ...(s.kinds ?? {}) }, webhooks: s.webhooks ?? [] };
}

/** Validates settings sent by the UI; returns an error message or null. */
export function validateSettings(value: any): string | null {
  if (!value || typeof value !== "object") return "Réglages invalides";
  if (!Array.isArray(value.webhooks)) return "webhooks doit être une liste";
  for (const w of value.webhooks) {
    if (!w || typeof w.url !== "string" || !["discord", "json"].includes(w.format)) return "Webhook invalide";
    let u: URL;
    try {
      u = new URL(w.url);
    } catch {
      return `Adresse invalide : ${w.url}`;
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "Les webhooks doivent être en https:// (ou http://localhost)";
  }
  return null;
}

// ---- What changed ----

const text = (html: unknown) =>
  String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const subject = (s: any) => String(s?.name ?? "?");
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const TZ = process.env.TZ || "Europe/Paris";
const points = (v: any) => (v && v.kind === 0 && Number.isFinite(v.points) ? String(Math.round(v.points * 100) / 100).replace(".", ",") : null);

export type Snapshot = { grades?: any; homework?: any[]; news?: any; timetable?: any[] };

export function takeSnapshot(store: Store): Snapshot {
  return { grades: store.get("grades"), homework: store.get("homework"), news: store.get("news"), timetable: store.get("timetable") };
}

/** Events for what's in `after` but wasn't in `before`. Nothing on the very first sync. */
export function diff(before: Snapshot, after: Snapshot, archive: Record<string, unknown> = {}): NotifyEvent[] {
  const events: NotifyEvent[] = [];
  const at = Date.now();
  const add = (kind: EventKind, key: string, title: string, body: string) => events.push({ id: `${kind}:${key}`, kind, title, body, at });

  // Grades: Pronote ids change every session, so compare on content.
  if (before.grades && after.grades) {
    const gradeKey = (g: any) => `${subject(g.subject)}|${g.date}|${g.comment ?? ""}|${JSON.stringify(g.value)}|${JSON.stringify(g.outOf)}`;
    const seen = new Set<string>();
    for (const p of Object.values<any>(before.grades.byPeriod ?? {})) for (const g of p.grades ?? []) seen.add(gradeKey(g));
    const added = new Set<string>();
    for (const p of Object.values<any>(after.grades.byPeriod ?? {})) {
      for (const g of p.grades ?? []) {
        const k = gradeKey(g);
        if (seen.has(k) || added.has(k)) continue;
        added.add(k);
        const v = points(g.value);
        const outOf = points(g.outOf);
        const avg = points(g.average);
        add("grade", k, `${KIND_LABELS.grade} en ${subject(g.subject)}`,
          [v && outOf ? `${v}/${outOf}` : "Note non chiffrée", g.comment, avg ? `moyenne de la classe ${avg}` : ""].filter(Boolean).join(" · "));
      }
    }
  }

  // Homework: new keys (subject + day + text), not already archived.
  if (before.homework && after.homework) {
    const seen = new Set([...before.homework.map(homeworkKey), ...Object.keys(archive)]);
    for (const a of after.homework) {
      const k = homeworkKey(a);
      if (seen.has(k)) continue;
      seen.add(k);
      add("homework", k, `${KIND_LABELS.homework} en ${subject(a.subject)}`, `Pour ${day(a.deadline)} : ${text(a.description).slice(0, 200)}`);
    }
  }

  if (before.news?.items && after.news?.items) {
    const seen = new Set(before.news.items.map((i: any) => i.key));
    for (const i of after.news.items) {
      if (seen.has(i.key)) continue;
      add("news", i.key, i.title || KIND_LABELS.news, [i.author, text(i.content).slice(0, 200)].filter(Boolean).join(" — "));
    }
  }

  // Classes that became canceled (only upcoming ones).
  if (before.timetable && after.timetable) {
    const lessonKey = (c: any) => `${subject(c.subject)}|${c.startDate}`;
    const wasCanceled = new Map(before.timetable.map((c: any) => [lessonKey(c), Boolean(c.canceled)]));
    for (const c of after.timetable) {
      const k = lessonKey(c);
      if (!c.canceled || wasCanceled.get(k) !== false || new Date(c.startDate).getTime() < at) continue;
      add("canceled", k, `${KIND_LABELS.canceled} : ${subject(c.subject)}`, `${day(c.startDate)} à ${time(c.startDate)}${c.status ? ` (${c.status})` : ""}`);
    }
  }
  return events;
}

// ---- Delivery ----

type SystemNotifier = (event: NotifyEvent) => void;
let systemNotifier: SystemNotifier | null = null;

/** The desktop and Android apps show system notifications through this. */
export function setSystemNotifier(fn: SystemNotifier): void {
  systemNotifier = fn;
}
export const hasSystemNotifier = () => systemNotifier !== null;

/** One notification on the device only (not webhooks), e.g. "update available". */
export function showSystemNotification(event: NotifyEvent): void {
  try {
    systemNotifier?.(event);
  } catch {}
}

const RECENT = "recentEvents";
const MAX_RECENT = 50;

export function recentEvents(store: Store): NotifyEvent[] {
  return store.getSetting<NotifyEvent[]>(RECENT) ?? [];
}

/** Sends events to every enabled channel. Never throws. */
export async function dispatch(store: Store, events: NotifyEvent[], { force = false } = {}): Promise<string[]> {
  const settings = getSettings(store);
  const wanted = force ? events : events.filter((e) => settings.kinds[e.kind]);
  if (!wanted.length) return [];
  if (!force) store.setSetting(RECENT, [...wanted, ...recentEvents(store)].slice(0, MAX_RECENT));

  const errors: string[] = [];
  if (settings.system && systemNotifier) {
    // A burst (first sync after a long time) becomes one summary notification.
    const shown = wanted.length > 4
      ? [{ id: `summary:${Date.now()}`, kind: wanted[0].kind, title: `${wanted.length} nouveautés sur Pronote`, body: summarize(wanted), at: Date.now() }]
      : wanted;
    for (const e of shown) {
      try {
        systemNotifier(e);
      } catch (err) {
        errors.push(`système : ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  await Promise.all(settings.webhooks.map(async (w) => {
    try {
      await sendWebhook(w, wanted);
    } catch (err) {
      errors.push(`${w.name || new URL(w.url).hostname} : ${err instanceof Error ? err.message : err}`);
    }
  }));
  if (errors.length) console.error(`[notify] ${errors.join(" | ")}`);
  return errors;
}

function summarize(events: NotifyEvent[]): string {
  const counts = new Map<EventKind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const words: Record<EventKind, [string, string]> = {
    grade: ["note", "notes"], homework: ["devoir", "devoirs"], news: ["information", "informations"], canceled: ["cours annulé", "cours annulés"],
  };
  return [...counts].map(([k, n]) => `${n} ${words[k][n > 1 ? 1 : 0]}`).join(", ");
}

const COLORS: Record<EventKind, number> = { grade: 0x2a78d6, homework: 0x1baf7a, news: 0x8e44ad, canceled: 0xd0453a };

async function sendWebhook(w: Webhook, events: NotifyEvent[]): Promise<void> {
  // Discord takes at most 10 embeds per message.
  const batches = w.format === "discord" ? chunk(events, 10) : [events];
  for (const batch of batches) {
    const body = w.format === "discord"
      ? {
          username: "repronote",
          embeds: batch.map((e) => ({
            title: e.title.slice(0, 256),
            description: e.body.slice(0, 2000),
            color: COLORS[e.kind],
            timestamp: new Date(e.at).toISOString(),
          })),
        }
      : { source: "repronote", events: batch };
    const res = await fetch(w.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function testEvent(): NotifyEvent {
  return { id: `test:${Date.now()}`, kind: "news", title: "repronote : test", body: "Les notifications fonctionnent.", at: Date.now() };
}
