import { openDatabase } from "@/lib/db";
import { importHealthPayload } from "@/lib/ingest/health-import";

/** Fresh in-memory database with all migrations applied. Synthetic data only. */
export function testDb() {
  return openDatabase(":memory:");
}

export function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    source: "test-suite",
    syncId: "sync-" + Math.random().toString(36).slice(2),
    generatedAt: "2026-10-20T08:00:00Z",
    samples: [],
    ...overrides,
  };
}

export function doImport(db: ReturnType<typeof testDb>, body: Record<string, unknown>, now = Date.parse("2026-10-20T09:00:00Z")) {
  return importHealthPayload(db, body, { rawBody: JSON.stringify(body), now });
}
