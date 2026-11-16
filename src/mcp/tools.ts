import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * MCP tools for AI assistants. Every tool goes through repronote's local HTTP
 * API at `baseUrl`, so the in-server endpoint (/mcp) and the stdio command
 * (`npm run mcp`) behave the same.
 */
export function createMcpServer(baseUrl: string): McpServer {
  const server = new McpServer({ name: "repronote", version: "0.1.0" });

  const api = async (path: string, init?: RequestInit): Promise<any> => {
    const r = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`repronote API ${path}: HTTP ${r.status}`);
    return r.json();
  };
  const state = () => api("/api/state");
  const snap = (s: any, kind: string) => s?.data?.[kind]?.data;
  const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
  const plain = (html: unknown) =>
    String(html ?? "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/\n{2,}/g, "\n").trim();
  const day = (d: string | Date) => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const time = (d: string | Date) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const parseDay = (v?: string) => (v ? startOfDay(new Date(`${v}T00:00:00`)) : startOfDay(new Date()));
  const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date as YYYY-MM-DD");

  const homeworkOut = (a: any) => ({
    id: a.id,
    subject: a.subject?.name,
    due: day(a.deadline),
    done: a.done,
    text: plain(a.description),
    attachments: (a.attachments ?? []).map((f: any) => f.name),
  });
  const classOut = (c: any) => ({
    subject: c.subject?.name ?? c.title,
    start: time(c.startDate),
    end: time(c.endDate),
    room: (c.classrooms ?? []).join(", "),
    teacher: (c.teacherNames ?? []).join(", "),
    status: c.status,
    canceled: c.canceled,
    test: c.test,
  });

  server.registerTool("get_today", {
    title: "Aujourd'hui",
    description: "Overview of the student's day: today's classes (or the next school day's), homework due in the next 3 days, unread school news count, last sync time.",
  }, async () => {
    const s = await state();
    const now = new Date();
    const classes = (snap(s, "timetable") ?? []).filter((c: any) => !c.canceled);
    const next = classes.filter((c: any) => new Date(c.endDate) > now).sort((a: any, b: any) => +new Date(a.startDate) - +new Date(b.startDate));
    const dayOf = next[0] ? startOfDay(new Date(next[0].startDate)) : null;
    const limit = new Date(startOfDay(now).getTime() + 3 * 864e5);
    return text({
      now: now.toLocaleString("fr-FR"),
      student: snap(s, "user"),
      classesOf: dayOf ? day(dayOf) : null,
      classes: dayOf ? next.filter((c: any) => +startOfDay(new Date(c.startDate)) === +dayOf).map(classOut) : [],
      homeworkNext3Days: (snap(s, "homework") ?? []).filter((a: any) => !a.done && new Date(a.deadline) >= startOfDay(now) && new Date(a.deadline) < limit).map(homeworkOut),
      unreadNews: (snap(s, "news")?.items ?? []).filter((i: any) => !i.read).length,
      lastSync: s.lastSuccessfulSync ? new Date(s.lastSuccessfulSync).toLocaleString("fr-FR") : null,
    });
  });

  server.registerTool("get_timetable", {
    title: "Emploi du temps",
    description: "Classes between two dates (default: today, 1 day). Synced range is about last week to 3 weeks ahead.",
    inputSchema: { from: dateArg.optional(), days: z.number().int().min(1).max(21).optional() },
  }, async ({ from, days }) => {
    const start = parseDay(from);
    const end = new Date(start.getTime() + (days ?? 1) * 864e5);
    const classes = (snap(await state(), "timetable") ?? [])
      .filter((c: any) => new Date(c.startDate) >= start && new Date(c.startDate) < end)
      .sort((a: any, b: any) => +new Date(a.startDate) - +new Date(b.startDate));
    const byDay: Record<string, unknown[]> = {};
    for (const c of classes) (byDay[day(c.startDate)] ??= []).push(classOut(c));
    return text(byDay);
  });

  server.registerTool("get_homework", {
    title: "Devoirs",
    description: "Homework due between two dates (default: today to 14 days ahead). Includes ids for set_homework_done.",
    inputSchema: {
      from: dateArg.optional(),
      to: dateArg.optional(),
      include_done: z.boolean().optional().describe("Also return homework already marked done (default false)"),
      subject: z.string().optional().describe("Filter: part of the subject name, e.g. MATH"),
    },
  }, async ({ from, to, include_done, subject }) => {
    const start = parseDay(from);
    const end = to ? parseDay(to) : new Date(start.getTime() + 14 * 864e5);
    const r = await api(`/api/homework/range?from=${start.toISOString().slice(0, 10)}&to=${end.toISOString().slice(0, 10)}`);
    const items = (r.items ?? [])
      .filter((a: any) => include_done || !a.done)
      .filter((a: any) => !subject || String(a.subject?.name ?? "").toLowerCase().includes(subject.toLowerCase()))
      .sort((a: any, b: any) => +new Date(a.deadline) - +new Date(b.deadline));
    return text({ offline: r.offline, homework: items.map(homeworkOut) });
  });

  server.registerTool("set_homework_done", {
    title: "Cocher un devoir",
    description: "Mark a homework as done or not done in Pronote (queued if offline). Use ids from get_homework or get_today.",
    inputSchema: { id: z.string(), done: z.boolean() },
    annotations: { destructiveHint: false, idempotentHint: true },
  }, async ({ id, done }) => {
    const r = await api(`/api/homework/${encodeURIComponent(id)}/done`, { method: "POST", body: JSON.stringify({ done }) });
    return text(r.queued ? "Enregistré : sera envoyé à Pronote à la prochaine connexion." : `OK : devoir marqué ${done ? "fait" : "non fait"}.`);
  });

  server.registerTool("get_grades", {
    title: "Notes",
    description: "Grades and averages for a period (default: Pronote's current period). Lists periods if the name doesn't match.",
    inputSchema: { period: z.string().optional().describe("Period name, e.g. 'Semestre 1'") },
  }, async ({ period }) => {
    const g = snap(await state(), "grades");
    if (!g) return text("Pas de notes synchronisées.");
    const p = period ? g.periods.find((x: any) => x.name.toLowerCase() === period.toLowerCase()) : g.periods.find((x: any) => x.id === g.defaultPeriodId);
    if (!p) return text({ error: "Période inconnue", periods: g.periods.map((x: any) => x.name) });
    const ov = g.byPeriod[p.id] ?? {};
    const val = (v: any) => (v && v.kind === 0 ? v.points : null);
    return text({
      period: p.name,
      overallAverage: val(ov.overallAverage),
      classAverage: val(ov.classAverage),
      subjects: (ov.subjectsAverages ?? []).map((s: any) => ({ subject: s.subject?.name, student: val(s.student), class: val(s.class_average), min: val(s.min), max: val(s.max) })),
      grades: (ov.grades ?? []).map((x: any) => ({
        subject: x.subject?.name, date: new Date(x.date).toLocaleDateString("fr-FR"), grade: val(x.value), outOf: val(x.outOf),
        coefficient: x.coefficient, classAverage: val(x.average), comment: x.comment,
      })),
    });
  });

  server.registerTool("get_news", {
    title: "Informations",
    description: "School news (informations / sondages) with their text. Keys are used by mark_news_read.",
    inputSchema: { unread_only: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() },
  }, async ({ unread_only, limit }) => {
    const items = [...(snap(await state(), "news")?.items ?? [])]
      .filter((i: any) => !unread_only || !i.read)
      .sort((a: any, b: any) => +new Date(b.startDate ?? b.creationDate) - +new Date(a.startDate ?? a.creationDate))
      .slice(0, limit ?? 10);
    return text(items.map((i: any) => ({
      key: i.key, title: i.title, author: i.author, category: i.category, date: i.startDate ? new Date(i.startDate).toLocaleDateString("fr-FR") : null,
      read: i.read, kind: i.is, text: plain(i.content).slice(0, 4000), attachments: (i.attachments ?? []).map((f: any) => f.name),
    })));
  });

  server.registerTool("mark_news_read", {
    title: "Marquer une information comme lue",
    description: "Mark a school news item as read or unread in Pronote. Use the key from get_news.",
    inputSchema: { key: z.string(), read: z.boolean() },
    annotations: { idempotentHint: true },
  }, async ({ key, read }) => {
    const r = await api("/api/news/read", { method: "POST", body: JSON.stringify({ key, read }) });
    return text(r.ok ? "OK" : `Échec : ${r.error ?? "inconnu"}`);
  });

  server.registerTool("get_notebook", {
    title: "Carnet",
    description: "Absences, delays, punishments and observations (carnet de correspondance / vie scolaire).",
  }, async () => {
    const nb = snap(await state(), "notebook");
    if (!nb) return text("Pas de carnet synchronisé.");
    return text({
      absences: nb.absences.map((a: any) => ({ from: new Date(a.startDate).toLocaleString("fr-FR"), to: new Date(a.endDate).toLocaleString("fr-FR"), justified: a.justified, reason: a.reason })),
      delays: nb.delays.map((d: any) => ({ date: new Date(d.date).toLocaleString("fr-FR"), minutes: d.minutes, justified: d.justified, reason: d.reason })),
      punishments: nb.punishments.map((p: any) => ({ title: p.title, date: new Date(p.dateGiven).toLocaleDateString("fr-FR"), giver: p.giver, reasons: p.reasons, workToDo: p.workToDo })),
      observations: nb.observations.map((o: any) => ({ name: o.name, date: new Date(o.date).toLocaleDateString("fr-FR"), subject: o.subject?.name, reason: o.reason })),
    });
  });

  server.registerTool("get_lesson_contents", {
    title: "Contenus de cours",
    description: "What was done in class (cahier de textes), last 4 weeks to 1 week ahead.",
    inputSchema: { subject: z.string().optional(), from: dateArg.optional(), to: dateArg.optional() },
  }, async ({ subject, from, to }) => {
    const start = from ? parseDay(from) : new Date(0);
    const end = to ? new Date(parseDay(to).getTime() + 864e5) : new Date(8.64e15);
    const items = (snap(await state(), "resources") ?? [])
      .filter((r: any) => r.contents?.length && new Date(r.startDate) >= start && new Date(r.startDate) < end)
      .filter((r: any) => !subject || String(r.subject?.name ?? "").toLowerCase().includes(subject.toLowerCase()))
      .sort((a: any, b: any) => +new Date(b.startDate) - +new Date(a.startDate));
    return text(items.map((r: any) => ({
      subject: r.subject?.name, date: day(r.startDate), teachers: r.teachers,
      contents: r.contents.map((c: any) => ({ title: c.title, category: c.categoryText, text: plain(c.description), files: (c.files ?? []).map((f: any) => f.name) })),
    })));
  });

  server.registerTool("list_documents", {
    title: "Documents",
    description: "Documents from the school's casier and every report card (bulletin), with local download links.",
  }, async () => {
    const d = snap(await state(), "documents");
    if (!d) return text("Pas de documents synchronisés.");
    const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
    return text({
      reportCards: d.bulletins.map((b: any) => ({ year: b.year, period: b.period, class: b.className, url: `${baseUrl}/api/doc/bulletin?${q({ ident: b.ident, n: b.file, period: b.period ?? "", year: b.year ?? "" })}` })),
      files: d.files.map((f: any) => ({ name: f.name, category: f.category?.name, date: f.date ? new Date(f.date).toLocaleDateString("fr-FR") : null, url: `${baseUrl}/api/doc/casier?${q({ id: f.id, n: f.name })}` })),
    });
  });

  server.registerTool("sync_now", {
    title: "Synchroniser",
    description: "Fetch fresh data from Pronote now (takes ~10-30 s).",
  }, async () => {
    const s = await api("/api/sync", { method: "POST" });
    return text(s.lastSync?.ok ? "Synchronisé." : `Échec : ${s.lastSync?.errorKind} ${s.lastSync?.message ?? ""}`);
  });

  return server;
}
