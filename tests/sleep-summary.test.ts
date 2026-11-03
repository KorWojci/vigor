import { describe, expect, it } from "vitest";
import { buildSleepSummaryContext, buildSleepSummaryPrompt, sleepSummaryResultSchema } from "@/lib/ai/sleep-summary";
import { doImport, envelope, testDb } from "./helpers";

const TZ = "UTC";

/** A simple 1-hour night of sleep, 22:00-23:00 on `day`. */
function oneHourNight(db: ReturnType<typeof testDb>, day: string) {
  doImport(db, envelope({ samples: [{ type: "sleep_analysis", category: "asleep_core", startAt: `${day}T22:00:00Z`, endAt: `${day}T23:00:00Z` }] }));
}

describe("buildSleepSummaryContext", () => {
  it("returns null for a night with no sleep data", () => {
    const db = testDb();
    expect(buildSleepSummaryContext(db, "2026-10-20", TZ)).toBeNull();
  });

  it("computes the recent average from prior nights, excluding the target night itself", () => {
    const db = testDb();
    // Three prior nights at ~1h logged, then the target night at a different length.
    oneHourNight(db, "2026-10-15");
    oneHourNight(db, "2026-10-16");
    oneHourNight(db, "2026-10-17");
    doImport(
      db,
      envelope({ samples: [{ type: "sleep_analysis", category: "asleep_core", startAt: "2026-10-18T22:00:00Z", endAt: "2026-10-19T00:30:00Z" }] }),
    );
    const ctx = buildSleepSummaryContext(db, "2026-10-19", TZ)!;
    expect(ctx).not.toBeNull();
    expect(ctx.asleepMinutes).toBeCloseTo(150, 5); // 2.5h
    expect(ctx.avgRecentAsleepMinutes).toBeCloseTo(60, 5); // average of the three 1h nights, not including the target
  });
});

describe("buildSleepSummaryPrompt", () => {
  it("includes bedtime/wake clock times and the recent-average comparison", () => {
    const db = testDb();
    oneHourNight(db, "2026-10-15");
    doImport(
      db,
      envelope({ samples: [{ type: "sleep_analysis", category: "asleep_deep", startAt: "2026-10-16T23:00:00Z", endAt: "2026-10-17T06:00:00Z" }] }),
    );
    const ctx = buildSleepSummaryContext(db, "2026-10-17", TZ)!;
    const prompt = buildSleepSummaryPrompt(ctx, TZ);
    const json = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(json.bedtime).toBe("23:00");
    expect(json.wake).toBe("06:00");
    expect(json.recentAverageAsleep).not.toBeNull();
  });
});

describe("sleepSummaryResultSchema", () => {
  it("accepts a well-formed response", () => {
    expect(sleepSummaryResultSchema.safeParse({ summary: "A solid night, close to your recent average." }).success).toBe(true);
  });

  it("rejects a response missing the summary field", () => {
    expect(sleepSummaryResultSchema.safeParse({}).success).toBe(false);
  });
});
