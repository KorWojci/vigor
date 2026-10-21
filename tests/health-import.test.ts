import { describe, expect, it } from "vitest";
import { deleteSampleById, ImportValidationError, importHealthPayload, startOfDayFor } from "@/lib/ingest/health-import";
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

  it("accepts the uniform rows of a single-loop Shortcut", () => {
    const db = testDb();
    // Every row carries the Health "Value" in both `value` and `category`, typed or as text.
    const row = (type: string, v: number | string, unit: string, startAt: string, endAt = startAt) => ({
      type, value: v, category: String(v), unit, startAt, endAt, sourceName: "SYNTHETIC Watch",
    });
    const res = doImport(
      db,
      envelope({
        samples: [
          row("step_count", 842, "count", "2026-10-20T07:00:00+02:00", "2026-10-20T07:30:00+02:00"),
          row("body_mass", "80,4", "kg", "2026-10-20T07:05:00+02:00"),
          row("distance_walking_running", " 1.25 ", "km", "2026-10-20T07:00:00+02:00", "2026-10-20T07:30:00+02:00"),
          row("sleep_analysis", "Deep", "", "2026-10-20T01:00:00+02:00", "2026-10-20T02:00:00+02:00"),
          row("step_count", "1,234", "count", "2026-10-20T06:00:00+02:00", "2026-10-20T06:30:00+02:00"),
        ],
      }),
    );
    expect(res.summary).toMatchObject({ accepted: 4, rejected: 1 });
    expect(res.rejections[0].reason).toMatch(/not an unambiguous number/);
    const rows = db.prepare("SELECT type, value, category FROM health_samples ORDER BY id").all();
    expect(rows).toEqual([
      { type: "step_count", value: 842, category: null },
      { type: "body_mass", value: 80.4, category: null },
      { type: "distance_walking_running", value: 1250, category: null },
      { type: "sleep_analysis", value: 60, category: "asleep_deep" },
    ]);
  });

  it("soft-deletes one imported sample by row id, as a tombstone", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps("a", 1), steps("b", 1)] }));
    const { id } = db.prepare("SELECT id FROM health_samples ORDER BY id LIMIT 1").get() as { id: number };
    expect(deleteSampleById(db, id)).toBe(true);
    expect(db.prepare("SELECT deleted_at FROM health_samples WHERE id = ?").get(id)).toMatchObject({ deleted_at: expect.any(Number) });
    expect(deleteSampleById(db, id)).toBe(false); // already gone — safe to retry
    expect(deleteSampleById(db, 999_999)).toBe(false); // unknown id
  });

  it("replaceToday fills in a per-type 'local midnight to generatedAt' window when replaceWindows is omitted", () => {
    const db = testDb();
    // Pre-existing data: a stale step_count sample earlier today, one from yesterday, and a
    // body_mass sample today — none of these are sent again in the run below.
    doImport(
      db,
      envelope({
        samples: [
          { ...steps("stale-today", 11, "2026-10-20T03:00:00Z", "2026-10-20T03:05:00Z") },
          { ...steps("prev-day", 22, "2026-10-19T23:00:00Z", "2026-10-19T23:05:00Z") },
          { type: "body_mass", value: 80, unit: "kg", startAt: "2026-10-20T04:00:00Z", externalId: "weight-today" },
        ],
      }),
    );

    doImport(db, envelope({ samples: [steps(undefined, 999, "2026-10-20T07:30:00Z", "2026-10-20T07:45:00Z")], replaceToday: true }));

    const kept = live(db).map((r) => r.external_id);
    expect(kept).not.toContain("stale-today"); // today, same type, not re-sent — replaced away
    expect(kept).toContain("prev-day"); // yesterday — outside today's window
    expect(kept).toContain("weight-today"); // different type — step_count's window doesn't touch it
    expect(db.prepare("SELECT value FROM health_samples WHERE type = 'step_count' AND deleted_at IS NULL ORDER BY start_ms").all()).toEqual([
      { value: 22 }, // prev-day, outside today's window — untouched
      { value: 999 }, // the newly sent sample
    ]);
  });

  it("replaceToday does nothing when the batch has no accepted samples (nothing to scope a window to)", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [steps("a", 1, "2026-10-20T03:00:00Z", "2026-10-20T03:05:00Z")] }));
    doImport(db, envelope({ samples: [], replaceToday: true }));
    expect(live(db).map((r) => r.external_id)).toContain("a");
  });

  it("an explicit replaceWindows always wins over replaceToday", () => {
    const db = testDb();
    doImport(
      db,
      envelope({
        samples: [
          { ...steps("stale-steps", 11, "2026-10-20T03:00:00Z", "2026-10-20T03:05:00Z") },
          { type: "body_mass", value: 80, unit: "kg", startAt: "2026-10-20T04:00:00Z", externalId: "stale-weight" },
        ],
      }),
    );
    // Sends a new sample of EACH type, declares an explicit window for step_count only, but also
    // sets replaceToday — the explicit window must be used as-is; no implicit window for body_mass.
    doImport(
      db,
      envelope({
        samples: [steps(undefined, 999, "2026-10-20T07:30:00Z", "2026-10-20T07:45:00Z"), { type: "body_mass", value: 81, unit: "kg", startAt: "2026-10-20T07:50:00Z" }],
        replaceWindows: [{ type: "step_count", startAt: "2026-10-20T00:00:00Z", endAt: "2026-10-20T08:00:00Z" }],
        replaceToday: true,
      }),
    );
    const kept = live(db).map((r) => r.external_id);
    expect(kept).not.toContain("stale-steps"); // covered by the explicit window
    expect(kept).toContain("stale-weight"); // body_mass had no explicit window — replaceToday did not fill one in
  });

  it("startOfDayFor uses the timestamp's own offset, not UTC, to find local midnight", () => {
    expect(startOfDayFor("2026-10-20T08:00:00Z")).toBe(Date.parse("2026-10-20T00:00:00Z"));
    // 23:50 in +02:00 is still Oct 20 locally, even though in UTC it's already Oct 20 21:50 —
    // a naive UTC-day floor would (here, harmlessly) agree, so check a case where it wouldn't:
    expect(startOfDayFor("2026-10-20T23:50:00+02:00")).toBe(Date.parse("2026-10-20T00:00:00+02:00"));
    expect(startOfDayFor("2026-10-20T23:50:00+02:00")).not.toBe(Date.parse("2026-10-20T00:00:00Z"));
    // 23:00 in -05:00 is Oct 21 04:00 UTC — the naive UTC-day floor would wrongly land on Oct 21.
    expect(startOfDayFor("2026-10-20T23:00:00-05:00")).toBe(Date.parse("2026-10-20T00:00:00-05:00"));
    expect(startOfDayFor("not a date")).toBeNull();
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
