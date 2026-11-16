import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "../core/config.ts";

/**
 * Local copy of the Pronote data, so the UI works offline.
 * - snapshots: one JSON document per kind ("homework", "timetable", ...)
 * - pending: actions made while offline, sent at the next sync
 * - sync_log: history of sync attempts
 *
 * Kept in SQLite (node:sqlite) when the runtime has it, else in a JSON file
 * (the Android app embeds Node 18, which has no node:sqlite).
 */

export type Snapshot = { data: unknown; fetchedAt: number };

export type SyncStatus = {
  at: number;
  ok: boolean;
  /** "offline": Pronote unreachable, "login": ENT wants a login, "error": anything else. */
  errorKind?: "offline" | "login" | "error";
  message?: string;
};

export type PendingAction = { id: number; type: "homeworkDone"; payload: { id: string; done: boolean }; createdAt: number };

/** What a storage engine provides; Store adds the logic on top. */
interface Backend {
  getRaw(kind: string): Snapshot | undefined;
  putRaw(kind: string, snapshot: Snapshot): void;
  all(): Record<string, Snapshot>;
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
  pending(): PendingAction[];
  addPending(type: PendingAction["type"], payload: PendingAction["payload"], createdAt: number): void;
  removePending(id: number): void;
  logSync(status: SyncStatus): void;
  lastSync(): SyncStatus | null;
  lastSuccessfulSync(): number | null;
}

export class Store {
  private readonly backend: Backend;

  private constructor(backend: Backend) {
    this.backend = backend;
  }

  static async open(dir = DATA_DIR): Promise<Store> {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let sqlite: typeof import("node:sqlite") | null = null;
    try {
      sqlite = await import("node:sqlite");
    } catch {}
    return new Store(sqlite ? new SqliteBackend(sqlite, `${dir}pronote.db`) : new JsonBackend(`${dir}pronote.json`));
  }

  put(kind: string, data: unknown, fetchedAt = Date.now()): void {
    this.backend.putRaw(kind, { data, fetchedAt });
  }

  get<T = unknown>(kind: string): T | undefined {
    return this.backend.getRaw(kind)?.data as T | undefined;
  }

  /** Changes a snapshot in place without touching its fetch time. */
  patch<T>(kind: string, change: (data: T) => T): void {
    const current = this.backend.getRaw(kind);
    if (current === undefined) return;
    this.backend.putRaw(kind, { data: change(current.data as T), fetchedAt: current.fetchedAt });
  }

  all(): Record<string, Snapshot> {
    return this.backend.all();
  }

  /** UI preferences (home layout...), kept server-side so every browser sees them. */
  getSetting<T = unknown>(key: string): T | null {
    return (this.backend.getSetting(key) as T | undefined) ?? null;
  }

  setSetting(key: string, value: unknown): void {
    this.backend.setSetting(key, value);
  }

  addPending(type: PendingAction["type"], payload: PendingAction["payload"]): void {
    // A newer action on the same homework replaces the older one.
    for (const p of this.pending()) {
      if (p.type === type && p.payload.id === payload.id) this.removePending(p.id);
    }
    this.backend.addPending(type, payload, Date.now());
  }

  pending(): PendingAction[] {
    return this.backend.pending();
  }

  removePending(id: number): void {
    this.backend.removePending(id);
  }

  logSync(status: SyncStatus): void {
    this.backend.logSync(status);
  }

  lastSync(): SyncStatus | null {
    return this.backend.lastSync();
  }

  lastSuccessfulSync(): number | null {
    return this.backend.lastSuccessfulSync();
  }
}

class SqliteBackend implements Backend {
  private db: import("node:sqlite").DatabaseSync;

  constructor(sqlite: typeof import("node:sqlite"), path: string) {
    this.db = new sqlite.DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        kind TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        error_kind TEXT,
        message TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  getRaw(kind: string): Snapshot | undefined {
    const row = this.db.prepare("SELECT data, fetched_at FROM snapshots WHERE kind = ?").get(kind) as { data: string; fetched_at: number } | undefined;
    return row ? { data: JSON.parse(row.data), fetchedAt: row.fetched_at } : undefined;
  }

  putRaw(kind: string, { data, fetchedAt }: Snapshot): void {
    this.db
      .prepare(
        `INSERT INTO snapshots (kind, data, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(kind, JSON.stringify(data), fetchedAt);
  }

  all(): Record<string, Snapshot> {
    const rows = this.db.prepare("SELECT kind, data, fetched_at FROM snapshots").all() as Array<{ kind: string; data: string; fetched_at: number }>;
    return Object.fromEntries(rows.map((r) => [r.kind, { data: JSON.parse(r.data), fetchedAt: r.fetched_at }]));
  }

  getSetting(key: string): unknown {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  pending(): PendingAction[] {
    const rows = this.db.prepare("SELECT * FROM pending ORDER BY id").all() as any[];
    return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), createdAt: r.created_at }));
  }

  addPending(type: PendingAction["type"], payload: PendingAction["payload"], createdAt: number): void {
    this.db.prepare("INSERT INTO pending (type, payload, created_at) VALUES (?, ?, ?)").run(type, JSON.stringify(payload), createdAt);
  }

  removePending(id: number): void {
    this.db.prepare("DELETE FROM pending WHERE id = ?").run(id);
  }

  logSync(status: SyncStatus): void {
    this.db
      .prepare("INSERT INTO sync_log (at, ok, error_kind, message) VALUES (?, ?, ?, ?)")
      .run(status.at, status.ok ? 1 : 0, status.errorKind ?? null, status.message ?? null);
  }

  lastSync(): SyncStatus | null {
    const row = this.db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").get() as any;
    return row ? { at: row.at, ok: !!row.ok, errorKind: row.error_kind ?? undefined, message: row.message ?? undefined } : null;
  }

  lastSuccessfulSync(): number | null {
    const row = this.db.prepare("SELECT at FROM sync_log WHERE ok = 1 ORDER BY id DESC LIMIT 1").get() as any;
    return row?.at ?? null;
  }
}

type JsonFile = {
  snapshots: Record<string, Snapshot>;
  settings: Record<string, unknown>;
  pending: PendingAction[];
  nextPendingId: number;
  /** Most recent last; capped. */
  syncLog: SyncStatus[];
};

/** Everything in memory, written to one JSON file (atomically) after each change. */
class JsonBackend implements Backend {
  private state: JsonFile;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    try {
      this.state = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      this.state = { snapshots: {}, settings: {}, pending: [], nextPendingId: 1, syncLog: [] };
    }
  }

  private save(): void {
    if (this.state.syncLog.length > 200) this.state.syncLog = this.state.syncLog.slice(-200);
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.state));
    renameSync(`${this.path}.tmp`, this.path);
  }

  getRaw(kind: string): Snapshot | undefined {
    const s = this.state.snapshots[kind];
    return s && structuredClone(s);
  }

  putRaw(kind: string, snapshot: Snapshot): void {
    this.state.snapshots[kind] = structuredClone(snapshot);
    this.save();
  }

  all(): Record<string, Snapshot> {
    return structuredClone(this.state.snapshots);
  }

  getSetting(key: string): unknown {
    return structuredClone(this.state.settings[key]);
  }

  setSetting(key: string, value: unknown): void {
    this.state.settings[key] = structuredClone(value);
    this.save();
  }

  pending(): PendingAction[] {
    return structuredClone(this.state.pending);
  }

  addPending(type: PendingAction["type"], payload: PendingAction["payload"], createdAt: number): void {
    this.state.pending.push({ id: this.state.nextPendingId++, type, payload, createdAt });
    this.save();
  }

  removePending(id: number): void {
    this.state.pending = this.state.pending.filter((p) => p.id !== id);
    this.save();
  }

  logSync(status: SyncStatus): void {
    this.state.syncLog.push({ ...status });
    this.save();
  }

  lastSync(): SyncStatus | null {
    return this.state.syncLog.at(-1) ?? null;
  }

  lastSuccessfulSync(): number | null {
    for (let i = this.state.syncLog.length - 1; i >= 0; i--) if (this.state.syncLog[i].ok) return this.state.syncLog[i].at;
    return null;
  }
}
