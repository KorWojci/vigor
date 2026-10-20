import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { closeDb, getDb, type DB } from "../db";
import { migrations } from "../db/migrations";

/** Backup, restore, export and deletion of personal data. See docs/deployment.md#backup-and-restore. */

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: number;
}

const BACKUP_NAME = /^vigor-[a-z0-9-]+\.db$/;

export function createBackup(db: DB, label = "manual"): BackupFile {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").toLowerCase();
  const name = `vigor-${label}-${stamp}.db`;
  const target = path.join(config.backupDir, name);
  // VACUUM INTO produces a consistent, compact copy while the database stays online.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const st = fs.statSync(target);
  return { name, bytes: st.size, createdAt: st.mtimeMs };
}

export function listBackups(): BackupFile[] {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs
    .readdirSync(config.backupDir)
    .filter((n) => BACKUP_NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(config.backupDir, name));
      return { name, bytes: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Resolves a backup name to a path, refusing anything outside the backup directory. */
export function backupPath(name: string): string | null {
  if (!BACKUP_NAME.test(name)) return null;
  const p = path.join(config.backupDir, name);
  return fs.existsSync(p) ? p : null;
}

export function deleteBackup(name: string): void {
  const p = backupPath(name);
  if (p) fs.unlinkSync(p);
}

/** Checks that a file is a Vigor database this version can open. */
export function validateBackupFile(file: string): { schemaVersion: number } {
  let probe: Database.Database | null = null;
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = probe.pragma("quick_check", { simple: true });
    if (integrity !== "ok") throw new Error("The backup file is corrupted.");
    const row = probe.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    const v = row.v ?? 0;
    const latest = Math.max(...migrations.map((m) => m.version));
    if (v < 1) throw new Error("Not a Vigor database.");
    if (v > latest) throw new Error(`Backup was made by a newer Vigor version (schema ${v} > ${latest}). Upgrade Vigor first.`);
    probe.prepare("SELECT 1 FROM health_samples LIMIT 1").all();
    return { schemaVersion: v };
  } catch (err) {
    if (err instanceof Error && /file is not a database|no such table/i.test(err.message)) throw new Error("Not a Vigor database.");
    throw err;
  } finally {
    probe?.close();
  }
}

/**
 * Replaces the live database with an uploaded backup. The current database is backed up first.
 * Older-schema backups are migrated on reopen.
 */
export function restoreFromBuffer(buf: Buffer): { schemaVersion: number; safetyBackup: string } {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const tmp = path.join(config.dataDir, `restore-${Date.now()}.tmp.db`);
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  try {
    const { schemaVersion } = validateBackupFile(tmp);
    const safety = createBackup(getDb(), "pre-restore");
    closeDb();
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(config.dbPath + suffix, { force: true });
    fs.renameSync(tmp, config.dbPath);
    getDb();
    return { schemaVersion, safetyBackup: safety.name };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export type DeleteScope = "health" | "workouts" | "measurements" | "imports" | "everything";

/** Permanently deletes personal records. Accounts, tokens and settings are kept unless "everything". */
export function deleteData(db: DB, scope: DeleteScope, source?: string): Record<string, number> {
  const counts: Record<string, number> = {};
  db.transaction(() => {
    const run = (label: string, sql: string, ...args: unknown[]) => {
      counts[label] = db.prepare(sql).run(...args).changes;
    };
    if (scope === "health" || scope === "everything") {
      if (source) run("health_samples", "DELETE FROM health_samples WHERE source = ?", source);
      else run("health_samples", "DELETE FROM health_samples");
      if (source) run("sync_cursors", "DELETE FROM sync_cursors WHERE source = ?", source);
      else run("sync_cursors", "DELETE FROM sync_cursors");
      run("apple_health_workouts", "DELETE FROM workouts WHERE source != 'hevy'" + (source ? " AND source = ?" : ""), ...(source ? [source] : []));
    }
    if (scope === "workouts" || scope === "everything") {
      run("workouts", "DELETE FROM workouts" + (source ? " WHERE source = ?" : ""), ...(source ? [source] : []));
      run("exercises", "DELETE FROM exercises WHERE id NOT IN (SELECT exercise_id FROM workout_exercises)");
    }
    if (scope === "measurements" || scope === "everything") {
      run("body_measurements", "DELETE FROM body_measurements");
      run("custom_measurement_types", "DELETE FROM measurement_types WHERE builtin = 0");
    }
    if (scope === "imports" || scope === "everything") {
      run("import_runs", "DELETE FROM import_runs");
      run("sync_client_status", "DELETE FROM sync_client_status");
    }
    if (scope === "everything") {
      run("settings", "DELETE FROM settings");
      run("api_tokens", "DELETE FROM api_tokens");
    }
  })();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return counts;
}

/** Tables included in the JSON export (secrets — password hashes, sessions, token hashes — excluded). */
const EXPORT_TABLES: { table: string; columns: string; where?: string }[] = [
  { table: "settings", columns: "key, value" },
  { table: "measurement_types", columns: "key, label, dimension, region, builtin" },
  { table: "body_measurements", columns: "id, type_key, value, measured_at, note, created_at" },
  {
    table: "health_samples",
    columns: "id, type, value, unit, category, start_ms, end_ms, source, source_name, source_bundle, device, external_id, metadata, created_at, updated_at",
    where: "deleted_at IS NULL",
  },
  { table: "workouts", columns: "id, source, external_id, title, activity_type, start_ms, end_ms, duration_s, energy_kcal, distance_m, avg_hr, max_hr, source_name, notes", where: "deleted_at IS NULL" },
  { table: "exercises", columns: "id, name, kind" },
  { table: "exercise_aliases", columns: "alias, exercise_id" },
  { table: "workout_exercises", columns: "id, workout_id, exercise_id, position, source_title, superset_id, notes" },
  { table: "exercise_sets", columns: "id, workout_exercise_id, set_index, set_type, weight_kg, reps, distance_m, duration_s, rpe" },
  { table: "import_runs", columns: "id, kind, source, sync_id, status, started_at, finished_at, received, accepted, updated, skipped, rejected, deleted, error" },
];

/** Streams a JSON export of all personal data, row by row (works for large histories). */
export function exportStream(db: DB): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  async function* generate() {
    yield `{"format":"vigor-export","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"units":"canonical (see docs/architecture.md)","tables":{`;
    let firstTable = true;
    for (const t of EXPORT_TABLES) {
      yield `${firstTable ? "" : ","}${JSON.stringify(t.table)}:[`;
      firstTable = false;
      let first = true;
      let batch = "";
      for (const row of db.prepare(`SELECT ${t.columns} FROM ${t.table}${t.where ? ` WHERE ${t.where}` : ""} ORDER BY rowid`).iterate()) {
        batch += (first ? "" : ",") + JSON.stringify(row);
        first = false;
        if (batch.length > 64_000) {
          yield batch;
          batch = "";
        }
      }
      yield batch + "]";
    }
    yield "}}";
  }
  const it = generate();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(enc.encode(value));
    },
  });
}

export interface StorageStats {
  dbBytes: number;
  counts: Record<string, number>;
}

export function storageStats(db: DB): StorageStats {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(config.dbPath).size;
  } catch {
    // in-memory database (tests)
  }
  return {
    dbBytes,
    counts: {
      "Health samples": count("SELECT COUNT(*) AS n FROM health_samples WHERE deleted_at IS NULL"),
      "Deleted samples (kept for sync)": count("SELECT COUNT(*) AS n FROM health_samples WHERE deleted_at IS NOT NULL"),
      Workouts: count("SELECT COUNT(*) AS n FROM workouts WHERE deleted_at IS NULL"),
      Exercises: count("SELECT COUNT(*) AS n FROM exercises"),
      "Exercise sets": count("SELECT COUNT(*) AS n FROM exercise_sets"),
      "Body measurements": count("SELECT COUNT(*) AS n FROM body_measurements"),
      "Import runs": count("SELECT COUNT(*) AS n FROM import_runs"),
    },
  };
}
