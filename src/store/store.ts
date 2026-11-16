import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "../core/config.ts";

/**
 * Local copy of the Pronote data, so the UI works offline.
 * - snapshots: one JSON document per kind ("homework", "timetable", ...)
 * - pending: actions made while offline, sent at the next sync
 * - sync_log: history of sync attempts
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

export class Store {
  private db: DatabaseSync;

  constructor(path = `${DATA_DIR}pronote.db`) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
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

  put(kind: string, data: unknown, fetchedAt = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO snapshots (kind, data, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(kind, JSON.stringify(data), fetchedAt);
  }

  get<T = unknown>(kind: string): T | undefined {
    const row = this.db.prepare("SELECT data FROM snapshots WHERE kind = ?").get(kind) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  /** Changes a snapshot in place without touching its fetch time. */
  patch<T>(kind: string, change: (data: T) => T): void {
    const current = this.get<T>(kind);
    if (current === undefined) return;
    this.db.prepare("UPDATE snapshots SET data = ? WHERE kind = ?").run(JSON.stringify(change(current)), kind);
  }

  all(): Record<string, Snapshot> {
    const rows = this.db.prepare("SELECT kind, data, fetched_at FROM snapshots").all() as Array<{
      kind: string;
      data: string;
      fetched_at: number;
    }>;
    return Object.fromEntries(rows.map((r) => [r.kind, { data: JSON.parse(r.data), fetchedAt: r.fetched_at }]));
  }

  /** UI preferences (home layout...), kept server-side so every browser sees them. */
  getSetting<T = unknown>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  addPending(type: PendingAction["type"], payload: PendingAction["payload"]): void {
    // A newer action on the same homework replaces the older one.
    for (const p of this.pending()) {
      if (p.type === type && p.payload.id === payload.id) this.removePending(p.id);
    }
    this.db.prepare("INSERT INTO pending (type, payload, created_at) VALUES (?, ?, ?)").run(type, JSON.stringify(payload), Date.now());
  }

  pending(): PendingAction[] {
    const rows = this.db.prepare("SELECT * FROM pending ORDER BY id").all() as any[];
    return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), createdAt: r.created_at }));
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
