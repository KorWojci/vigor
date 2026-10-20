import type { DB } from "../db";
import { config } from "../config";

export type SyncHealth = "never" | "ok" | "stale" | "failing";

export interface ImportRunRow {
  id: number;
  kind: string;
  source: string;
  syncId: string | null;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  received: number;
  accepted: number;
  updated: number;
  skipped: number;
  rejected: number;
  deleted: number;
  payloadBytes: number | null;
  error: string | null;
  details: string | null;
}

export interface ClientStatus {
  source: string;
  reportedAt: number;
  pendingSamples: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export interface SyncStatus {
  state: SyncHealth;
  staleAfterHours: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastRun: ImportRunRow | null;
  lastError: string | null;
  failuresSinceSuccess: number;
  last24h: { runs: number; accepted: number; updated: number; deleted: number; rejected: number };
  sources: { source: string; lastSuccessAt: number | null; samples: number }[];
  clients: ClientStatus[];
  cursors: { source: string; scope: string; updatedAt: number }[];
}

const RUN_COLUMNS = `id, kind, source, sync_id AS syncId, status, started_at AS startedAt, finished_at AS finishedAt,
  received, accepted, updated, skipped, rejected, deleted, payload_bytes AS payloadBytes, error, details`;

export function listImportRuns(db: DB, kind: "health" | "hevy", limit = 25): ImportRunRow[] {
  return db.prepare(`SELECT ${RUN_COLUMNS} FROM import_runs WHERE kind = ? ORDER BY id DESC LIMIT ?`).all(kind, limit) as ImportRunRow[];
}

export function getSyncStatus(db: DB, now = Date.now(), staleAfterHours = config.staleAfterHours): SyncStatus {
  const lastSuccess = db
    .prepare("SELECT MAX(finished_at) AS t FROM import_runs WHERE kind='health' AND status IN ('success','partial')")
    .get() as { t: number | null };
  const lastRun = (db.prepare(`SELECT ${RUN_COLUMNS} FROM import_runs WHERE kind='health' ORDER BY id DESC LIMIT 1`).get() ??
    null) as ImportRunRow | null;
  const failures = db
    .prepare("SELECT COUNT(*) AS n FROM import_runs WHERE kind='health' AND status IN ('failed','rejected') AND started_at > ?")
    .get(lastSuccess.t ?? 0) as { n: number };
  const lastFailure = db
    .prepare("SELECT error FROM import_runs WHERE kind='health' AND status IN ('failed','rejected') ORDER BY id DESC LIMIT 1")
    .get() as { error: string | null } | undefined;
  const day = db
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(accepted),0) AS accepted, COALESCE(SUM(updated),0) AS updated,
       COALESCE(SUM(deleted),0) AS deleted, COALESCE(SUM(rejected),0) AS rejected
       FROM import_runs WHERE kind='health' AND started_at > ?`,
    )
    .get(now - 24 * 3600_000) as SyncStatus["last24h"];
  const sources = db
    .prepare(
      `SELECT r.source, MAX(r.finished_at) AS lastSuccessAt,
         (SELECT COUNT(*) FROM health_samples s WHERE s.source = r.source AND s.deleted_at IS NULL) AS samples
       FROM import_runs r WHERE r.kind='health' AND r.status IN ('success','partial') GROUP BY r.source ORDER BY lastSuccessAt DESC`,
    )
    .all() as SyncStatus["sources"];
  const clients = db
    .prepare(
      `SELECT source, reported_at AS reportedAt, pending_samples AS pendingSamples, last_attempt_at AS lastAttemptAt,
       last_success_at AS lastSuccessAt, last_error AS lastError FROM sync_client_status ORDER BY reported_at DESC`,
    )
    .all() as ClientStatus[];
  const cursors = db
    .prepare("SELECT source, scope, updated_at AS updatedAt FROM sync_cursors ORDER BY source, scope")
    .all() as SyncStatus["cursors"];

  let state: SyncHealth;
  if (!lastSuccess.t) state = lastRun ? "failing" : "never";
  else if (now - lastSuccess.t > staleAfterHours * 3600_000) state = failures.n > 0 ? "failing" : "stale";
  else state = "ok";

  return {
    state,
    staleAfterHours,
    lastSuccessAt: lastSuccess.t,
    lastAttemptAt: lastRun?.startedAt ?? null,
    lastRun,
    lastError: failures.n > 0 ? (lastFailure?.error ?? null) : null,
    failuresSinceSuccess: failures.n,
    last24h: day,
    sources,
    clients,
    cursors,
  };
}

export interface ClientReport {
  source: string;
  pendingSamples?: number | null;
  lastAttemptAt?: number | null;
  lastSuccessAt?: number | null;
  lastError?: string | null;
  details?: unknown;
}

/** Stores the queue/attempt state reported by the iPhone companion (Shortcuts cannot report this). */
export function recordClientStatus(db: DB, r: ClientReport, now = Date.now()): void {
  db.prepare(
    `INSERT INTO sync_client_status (source, reported_at, pending_samples, last_attempt_at, last_success_at, last_error, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET reported_at=excluded.reported_at, pending_samples=excluded.pending_samples,
       last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, last_error=excluded.last_error,
       details=excluded.details`,
  ).run(
    r.source,
    now,
    r.pendingSamples ?? null,
    r.lastAttemptAt ?? null,
    r.lastSuccessAt ?? null,
    r.lastError?.slice(0, 500) ?? null,
    r.details === undefined ? null : JSON.stringify(r.details).slice(0, 4000),
  );
}

export function getCursors(db: DB, source: string): { scope: string; value: string; updatedAt: number }[] {
  return db
    .prepare("SELECT scope, cursor AS value, updated_at AS updatedAt FROM sync_cursors WHERE source = ? ORDER BY scope")
    .all(source) as { scope: string; value: string; updatedAt: number }[];
}
