import path from "node:path";

/**
 * Runtime configuration, read from environment variables.
 * See .env.example and docs/deployment.md for the full list.
 */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  get dataDir(): string {
    return path.resolve(process.env.VIGOR_DATA_DIR || "./data");
  },
  get dbPath(): string {
    return process.env.VIGOR_DB_PATH
      ? path.resolve(process.env.VIGOR_DB_PATH)
      : path.join(this.dataDir, "vigor.db");
  },
  get backupDir(): string {
    return path.join(this.dataDir, "backups");
  },
  get secureCookies(): boolean {
    return process.env.VIGOR_SECURE_COOKIES === "true";
  },
  get maxImportBytes(): number {
    return intEnv("VIGOR_MAX_IMPORT_BYTES", 10 * 1024 * 1024);
  },
  get staleAfterHours(): number {
    return intEnv("VIGOR_STALE_AFTER_HOURS", 3);
  },
  get adminPassword(): string | undefined {
    return process.env.VIGOR_ADMIN_PASSWORD || undefined;
  },
};

/** The synchronisation interval Vigor is designed around (documented target, not a guarantee). */
export const SYNC_TARGET_INTERVAL_MINUTES = 60;
