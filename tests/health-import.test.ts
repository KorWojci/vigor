import { describe, expect, it } from "vitest";
import { ImportValidationError, importHealthPayload } from "@/lib/ingest/health-import";
import { parseTimestamp } from "@/lib/ingest/schema";
import { doImport, envelope, testDb } from "./helpers";

const steps = (externalId: string | undefined, value: number, start = "2026-10-20T07:00:00Z", end = "2026-10-20T08:00:00Z") => ({
  type: "step_count",
  value,
  unit: "count",
  startAt: start,
  endAt: end,
  sourceName: "Synthetic Watch",
  ...(externalId ? { externalId } : {}),
});

const live = (db: ReturnType<typeof testDb>) =>
  db.prepare("SELECT external_id, value FROM health_samples WHERE deleted_at IS NULL ORDER BY start_ms").all() as {
    external_id: string;
    value: number;
  }[];

describe("health import", () => {
  it("accepts valid samples and reports a summary", () => {
    const db = testDb();
    const res = doImport(db, envelope({ samples: [steps("a", 100), steps("b", 200, "2026-10-20T06:00:00Z", "2026-10-20T07:00:00Z")] }));
    expect(res.summary).toMatchObject({ received: 2, accepted: 2, updated: 0, skipped: 0, rejected: 0 });
    expect(res.status).toBe("success");
    expect(live(db)).toHaveLength(2);
  });

  it("is idempotent when the same request is retried", () => {
    const db = testDb();
    const body = envelope({ syncId: "retry-1", samples: [steps("a", 100)] });
    const first = doImport(db, body);
    const second = doImport(db, body);
    expect(second.replayed).toBe(true);
    expect(second.importRunId).toBe(first.importRunId);
    expect(live(db)).toHaveLength(1);
  });

  it("skips duplicates sent in a new sync (overlapping lookback window)", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps("a", 100)] }));
    const res = doImport(db, envelope({ samples: [steps("a", 100), steps("b", 50, "2026-10-20T08:00:00Z", "2026-10-20T08:30:00Z")] }));
    expect(res.summary).toMatchObject({ accepted: 1, skipped: 1 });
    expect(live(db)).toHaveLength(2);
  });

  it("deduplicates id-less samples by content", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps(undefined, 100)] }));
    const res = doImport(db, envelope({ samples: [steps(undefined, 100)] }));
    expect(res.summary.skipped).toBe(1);
    expect(live(db)).toHaveLength(1);
    expect(live(db)[0].external_id).toMatch(/^derived:/);
  });

  it("applies corrections to an existing external id", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps("a", 100)] }));
    const res = doImport(db, envelope({ samples: [steps("a", 120)] }));
    expect(res.summary.updated).toBe(1);
    expect(live(db)[0].value).toBe(120);
  });

  it("handles explicit deletions and is safe to repeat", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps("a", 100), steps("b", 5, "2026-10-20T05:00:00Z", "2026-10-20T06:00:00Z")] }));
    const res = doImport(db, envelope({ deleted: [{ externalId: "a" }, { externalId: "unknown" }] }));
    expect(res.summary).toMatchObject({ deleted: 1, skipped: 1 });
    expect(live(db).map((r) => r.external_id)).toEqual(["b"]);
    const again = doImport(db, envelope({ deleted: [{ externalId: "a" }] }));
    expect(again.summary.deleted).toBe(0);
  });

  it("replace windows soft-delete only same-source samples missing from the window", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps(undefined, 100), steps(undefined, 70, "2026-10-19T07:00:00Z", "2026-10-19T08:00:00Z")] }));
    doImport(db, envelope({ source: "other-source", samples: [steps(undefined, 999, "2026-10-20T09:00:00Z", "2026-10-20T09:30:00Z")] }));
    // The 07:00 sample on Oct 20 was corrected to 110 in Apple Health. A Shortcut re-sends the day.
    const res = doImport(
      db,
      envelope({
        samples: [steps(undefined, 110)],
        replaceWindows: [{ type: "step_count", startAt: "2026-10-20T00:00:00Z", endAt: "2026-10-21T00:00:00Z" }],
      }),
    );
    expect(res.summary).toMatchObject({ accepted: 1, deleted: 1 });
    expect(live(db).map((r) => r.value).sort((a, b) => a - b)).toEqual([70, 110, 999]);
  });

  it("rejects individual invalid samples but keeps the valid ones", () => {
    const db = testDb();
    const res = doImport(
      db,
      envelope({
        samples: [
          steps("ok", 10),
          { type: "unicorn_count", value: 1, unit: "count", startAt: "2026-10-20T07:00:00Z" },
          { type: "step_count", value: 1, unit: "kg", startAt: "2026-10-20T07:00:00Z" },
          { type: "step_count", unit: "count", startAt: "2026-10-20T07:00:00Z" },
          { type: "step_count", value: 1, unit: "count", startAt: "2026-10-20 07:00:00" },
          { type: "step_count", value: 1, unit: "count", startAt: "2030-01-01T00:00:00Z" },
        ],
      }),
    );
    expect(res.status).toBe("partial");
    expect(res.summary).toMatchObject({ accepted: 1, rejected: 5 });
    expect(res.rejections.map((r) => r.index)).toEqual([1, 2, 3, 4, 5]);
    expect(res.rejections[0].reason).toContain("unsupported metric type");
  });

  it("converts units to canonical units", () => {
    const db = testDb();
    doImport(
      db,
      envelope({
        samples: [
          { type: "body_mass", value: 176.37, unit: "lb", startAt: "2026-10-20T07:00:00Z", externalId: "w" },
          { type: "oxygen_saturation", value: 0.97, unit: "fraction", startAt: "2026-10-20T07:00:00Z", externalId: "o1" },
          { type: "oxygen_saturation", value: 0.96, unit: "%", startAt: "2026-10-20T07:05:00Z", externalId: "o2" },
          { type: "distance_walking_running", value: 1.5, unit: "km", startAt: "2026-10-20T07:00:00Z", endAt: "2026-10-20T07:20:00Z", externalId: "d" },
        ],
      }),
    );
    const v = (id: string) => (db.prepare("SELECT value FROM health_samples WHERE external_id = ?").get(id) as { value: number }).value;
    expect(v("w")).toBeCloseTo(80, 1);
    expect(v("o1")).toBeCloseTo(97);
    expect(v("o2")).toBeCloseTo(96);
    expect(v("d")).toBe(1500);
  });

  it("validates sleep categories", () => {
    const db = testDb();
    const res = doImport(
      db,
      envelope({
        samples: [
          { type: "sleep_analysis", category: "asleep_deep", unit: "", startAt: "2026-10-20T01:00:00Z", endAt: "2026-10-20T02:00:00Z" },
          { type: "sleep_analysis", category: "dreaming", unit: "", startAt: "2026-10-20T02:00:00Z", endAt: "2026-10-20T03:00:00Z" },
        ],
      }),
    );
    expect(res.summary).toMatchObject({ accepted: 1, rejected: 1 });
  });

  it("rejects malformed envelopes as a whole", () => {
    const db = testDb();
    expect(() => importHealthPayload(db, { schemaVersion: 2 }, { rawBody: "{}" })).toThrow(ImportValidationError);
    expect(() => importHealthPayload(db, envelope({ source: "bad source!" }), { rawBody: "{}" })).toThrow(ImportValidationError);
  });

  it("stores cursors only when the import succeeds", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps("a", 1)], cursors: [{ scope: "step_count", value: "anchor-1" }] }));
    const c = db.prepare("SELECT cursor FROM sync_cursors WHERE source='test-suite' AND scope='step_count'").get() as { cursor: string };
    expect(c.cursor).toBe("anchor-1");
  });

  it("upserts workouts and their deletions", () => {
    const db = testDb();
    const w = { activityType: "running", startAt: "2026-10-20T06:00:00Z", endAt: "2026-10-20T06:30:00Z", energyKcal: 300, externalId: "w1" };
    expect(doImport(db, envelope({ workouts: [w] })).summary.accepted).toBe(1);
    expect(doImport(db, envelope({ workouts: [{ ...w, energyKcal: 310 }] })).summary.updated).toBe(1);
    expect(doImport(db, envelope({ deleted: [{ externalId: "w1", kind: "workout" }] })).summary.deleted).toBe(1);
  });
});

describe("parseTimestamp", () => {
  it("requires an explicit offset", () => {
    expect(parseTimestamp("2026-10-20T08:00:00Z")).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(parseTimestamp("2026-10-20T10:00:00+02:00")).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(parseTimestamp("2026-10-20 10:00:00 +0200")).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(parseTimestamp("2026-10-20T08:00:00")).toBeNull();
    expect(parseTimestamp("yesterday")).toBeNull();
  });
});

describe("sleep category aliases", () => {
  it("accepts Shortcuts labels and HealthKit names", async () => {
    const { normaliseSleepCategory } = await import("@/lib/ingest/health-import");
    expect(normaliseSleepCategory("In Bed")).toBe("in_bed");
    expect(normaliseSleepCategory("Core")).toBe("asleep_core");
    expect(normaliseSleepCategory("HKCategoryValueSleepAnalysisAsleepREM")).toBe("asleep_rem");
    expect(normaliseSleepCategory("asleep_deep")).toBe("asleep_deep");
    expect(normaliseSleepCategory("dreaming")).toBeNull();
  });
});

describe("documented example payload", () => {
  it("samples/import-payload-example.json is accepted in full", async () => {
    const fs = await import("node:fs");
    const body = JSON.parse(fs.readFileSync(new URL("../samples/import-payload-example.json", import.meta.url), "utf8"));
    const res = doImport(testDb(), body);
    expect(res.summary).toMatchObject({ received: 5, accepted: 5, rejected: 0 });
  });
});
