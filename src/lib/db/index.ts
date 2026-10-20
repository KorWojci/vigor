import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { migrations } from "./migrations";
import { seedBuiltins } from "./seed";

export type DB = Database.Database;

const globalForDb = globalThis as unknown as { __vigorDb?: DB };

/** Opens (and if needed migrates) the database. Safe to call repeatedly. */
export function getDb(): DB {
  if (globalForDb.__vigorDb) return globalForDb.__vigorDb;
  const db = openDatabase(config.dbPath);
  globalForDb.__vigorDb = db;
  return db;
}

/** Closes the shared connection (used by restore and tests). */
export function closeDb(): void {
  globalForDb.__vigorDb?.close();
  globalForDb.__vigorDb = undefined;
}

/** Opens a database file (or ':memory:'), applies pragmas, migrations and seed data. */
export function openDatabase(file: string, opts: { backupBeforeMigrate?: boolean } = {}): DB {
  const inMemory = file === ":memory:";
  if (!inMemory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const existed = !inMemory && fs.existsSync(file);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  runMigrations(db, { backupFile: existed && opts.backupBeforeMigrate !== false ? file : undefined });
  seedBuiltins(db);
  return db;
}

export function currentSchemaVersion(db: DB): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  return row.v ?? 0;
}

export function runMigrations(db: DB, opts: { backupFile?: string } = {}): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const current = currentSchemaVersion(db);
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return [];

  // Upgrade safety: snapshot an existing database before changing its schema.
  if (opts.backupFile && current > 0) {
    const dir = path.join(path.dirname(opts.backupFile), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `vigor-pre-migration-v${current}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }

  const apply = db.transaction((m: (typeof migrations)[number]) => {
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      m.version,
      m.name,
      Date.now(),
    );
  });
  for (const m of pending) apply(m);
  return pending.map((m) => m.version);
}
