import { describe, expect, it } from "vitest";
import { aggregateAvg, aggregateLatest, aggregateSleep, aggregateSum, type RawSample } from "@/lib/aggregation/aggregate";
import { mergeIntervals } from "@/lib/aggregation/intervals";
import { getDailySeries, getMetricSummary } from "@/lib/aggregation/series";
import { addMeasurement } from "@/lib/body/repo";
import { makeRange, previousRange } from "@/lib/time";
import { doImport, envelope, testDb } from "./helpers";

const t = (iso: string) => Date.parse(iso);
const s = (start: string, end: string, value: number | null, sourceName = "Watch", category: string | null = null): RawSample => ({
  startMs: t(start),
  endMs: t(end),
  value,
  category,
  sourceName,
  source: "test",
});

describe("aggregateSum", () => {
  it("does not double count overlapping devices", () => {
    const samples = [
      s("2026-10-20T07:00:00Z", "2026-10-20T07:30:00Z", 1000, "iPhone"),
      s("2026-10-20T07:00:00Z", "2026-10-20T07:30:00Z", 1100, "Watch"),
      s("2026-10-20T09:00:00Z", "2026-10-20T09:30:00Z", 500, "iPhone"), // watch not worn
    ];
    const [day] = aggregateSum(samples, "max-source", "UTC");
    expect(day.value).toBe(1600);
    expect(aggregateSum(samples, "sum-all", "UTC")[0].value).toBe(2600);
  });

  it("falls back to daily per-source totals for long samples", () => {
    const samples = [
      s("2026-10-20T00:00:00Z", "2026-10-20T23:59:00Z", 8000, "Shortcut daily total"),
      s("2026-10-20T07:00:00Z", "2026-10-20T07:30:00Z", 3000, "Watch"),
    ];
    expect(aggregateSum(samples, "max-source", "UTC")[0].value).toBe(8000);
  });

  it("does not inflate a single continuously-tracked activity when the leading source alternates", () => {
    // A ~1.5h walk where phone and watch both record steps the whole time in small bursts, and
    // which of the two reports more varies minute to minute (measurement noise, not a real gap).
    // Deciding per fixed hour bucket and summing the winners would exceed both device totals;
    // deciding once per contiguous block must not.
    const samples = [
      s("2026-10-20T07:00:00Z", "2026-10-20T07:20:00Z", 1100, "Watch"),
      s("2026-10-20T07:00:00Z", "2026-10-20T07:20:00Z", 1000, "iPhone"),
      s("2026-10-20T07:20:00Z", "2026-10-20T07:40:00Z", 900, "Watch"),
      s("2026-10-20T07:20:00Z", "2026-10-20T07:40:00Z", 1050, "iPhone"),
      s("2026-10-20T07:40:00Z", "2026-10-20T08:00:00Z", 1200, "Watch"),
      s("2026-10-20T07:40:00Z", "2026-10-20T08:00:00Z", 1150, "iPhone"),
    ];
    const watchTotal = 1100 + 900 + 1200;
    const phoneTotal = 1000 + 1050 + 1150;
    expect(aggregateSum(samples, "max-source", "UTC")[0].value).toBe(Math.max(watchTotal, phoneTotal));
  });

  it("still fills a genuine gap (watch not worn) inside an otherwise shared activity", () => {
    const samples = [
      s("2026-10-20T07:00:00Z", "2026-10-20T07:20:00Z", 1000, "Watch"),
      s("2026-10-20T07:00:00Z", "2026-10-20T07:20:00Z", 950, "iPhone"),
      // Watch removed for this stretch — only the phone recorded it, so it must still count.
      s("2026-10-20T07:20:00Z", "2026-10-20T07:40:00Z", 800, "iPhone"),
      s("2026-10-20T07:40:00Z", "2026-10-20T08:00:00Z", 1100, "Watch"),
      s("2026-10-20T07:40:00Z", "2026-10-20T08:00:00Z", 1050, "iPhone"),
    ];
    // One continuous block (no gap with zero samples from every source) → one max-per-source decision.
    const watchTotal = 1000 + 1100; // no watch samples in the middle stretch
    const phoneTotal = 950 + 800 + 1050;
    expect(aggregateSum(samples, "max-source", "UTC")[0].value).toBe(Math.max(watchTotal, phoneTotal));
  });

  it("buckets days in the configured time zone", () => {
    const samples = [s("2026-10-19T23:30:00Z", "2026-10-19T23:45:00Z", 10)];
    expect(aggregateSum(samples, "sum-all", "UTC")[0].day).toBe("2026-10-19");
    expect(aggregateSum(samples, "sum-all", "Europe/Warsaw")[0].day).toBe("2026-10-20");
  });
});

describe("aggregateAvg / aggregateLatest", () => {
  it("computes mean/min/max", () => {
    const [d] = aggregateAvg([s("2026-10-20T07:00:00Z", "2026-10-20T07:00:00Z", 60), s("2026-10-20T08:00:00Z", "2026-10-20T08:00:00Z", 80)], "UTC");
    expect(d).toMatchObject({ value: 70, min: 60, max: 80, count: 2 });
  });
  it("keeps the last reading of the day", () => {
    const [d] = aggregateLatest([s("2026-10-20T07:00:00Z", "2026-10-20T07:00:00Z", 80.2), s("2026-10-20T20:00:00Z", "2026-10-20T20:00:00Z", 81)], "UTC");
    expect(d.value).toBe(81);
  });
});

describe("aggregateSleep", () => {
  it("merges overlapping sources and attributes the night to the wake-up day", () => {
    const samples = [
      s("2026-10-19T22:00:00Z", "2026-10-20T00:00:00Z", null, "Watch", "asleep_core"),
      s("2026-10-20T00:00:00Z", "2026-10-20T01:00:00Z", null, "Watch", "asleep_deep"),
      s("2026-10-20T01:00:00Z", "2026-10-20T02:00:00Z", null, "Watch", "asleep_rem"),
      s("2026-10-19T22:00:00Z", "2026-10-20T02:00:00Z", null, "Sleep app", "asleep_unspecified"),
      s("2026-10-19T21:45:00Z", "2026-10-20T02:15:00Z", null, "iPhone", "in_bed"),
    ];
    const [night] = aggregateSleep(samples, "UTC");
    expect(night.day).toBe("2026-10-20");
    expect(night.asleepMin).toBe(240);
    expect(night.inBedMin).toBe(270);
    expect(night.stages).toMatchObject({ core: 120, deep: 60, rem: 60, unspecified: 0 });
    expect(night.hasStages).toBe(true);
  });
});

describe("intervals", () => {
  it("merges", () => {
    expect(mergeIntervals([[5, 7], [1, 3], [2, 4]])).toEqual([[1, 4], [5, 7]]);
  });
});

describe("series from the database", () => {
  it("returns no entry (not zero) for days without data", () => {
    const db = testDb();
    doImport(db, envelope({ samples: [{ type: "step_count", value: 500, unit: "count", startAt: "2026-10-18T10:00:00Z", endAt: "2026-10-18T10:30:00Z" }] }));
    const range = makeRange("2026-10-14", "2026-10-20", "UTC");
    const series = getDailySeries(db, "step_count", range, "UTC");
    expect(series.map((d) => d.day)).toEqual(["2026-10-18"]);
    const summary = getMetricSummary(db, "vo2_max", range, previousRange(range, "UTC"), "UTC")!;
    expect(summary.value).toBeNull();
    expect(summary.latest).toBeNull();
  });

  it("recomputes daily totals after a late sample arrives", () => {
    const db = testDb();
    const range = makeRange("2026-10-20", "2026-10-20", "UTC");
    const sample = (id: string, h: string) => ({ type: "step_count", value: 100, unit: "count", startAt: `2026-10-20T${h}:00:00Z`, endAt: `2026-10-20T${h}:30:00Z`, externalId: id });
    doImport(db, envelope({ samples: [sample("a", "07")] }));
    expect(getDailySeries(db, "step_count", range, "UTC")[0].value).toBe(100);
    doImport(db, envelope({ samples: [sample("a", "07"), sample("late", "05")] }));
    expect(getDailySeries(db, "step_count", range, "UTC")[0].value).toBe(200);
  });

  it("merges manual body measurements into the weight series", () => {
    const db = testDb();
    addMeasurement(db, "weight", 82, t("2026-10-15T07:00:00Z"), null);
    doImport(db, envelope({ samples: [{ type: "body_mass", value: 81.5, unit: "kg", startAt: "2026-10-19T07:00:00Z", externalId: "bm" }] }));
    const range = makeRange("2026-10-14", "2026-10-20", "UTC");
    const sum = getMetricSummary(db, "body_mass", range, previousRange(range, "UTC"), "UTC")!;
    expect(sum.daily.map((d) => d.value)).toEqual([82, 81.5]);
    expect(sum.latest?.value).toBe(81.5);
  });
});
