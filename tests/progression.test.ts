import { describe, expect, it } from "vitest";
import { e1rmTrend, type E1rmPoint } from "@/lib/training/progression";

const day = (n: number) => n * 86_400_000;
const pt = (dayOffset: number, e1rmKg: number): E1rmPoint => ({ startMs: day(dayOffset), e1rmKg });

describe("e1rmTrend", () => {
  it("returns null with fewer than 4 sessions", () => {
    expect(e1rmTrend([pt(0, 100), pt(10, 102), pt(20, 104)])).toBeNull();
  });

  it("returns null when the sessions span under 14 days", () => {
    expect(e1rmTrend([pt(0, 100), pt(1, 101), pt(2, 102), pt(3, 103)])).toBeNull();
  });

  it("returns null when every session is on the same day (no time axis to regress on)", () => {
    expect(e1rmTrend([pt(0, 100), pt(0, 101), pt(0, 99), pt(0, 102)])).toBeNull();
  });

  it("recovers an exact linear trend with a perfect fit", () => {
    // +1 kg every 10 days = 0.1 kg/day, over 40 days.
    const points = [pt(0, 100), pt(10, 101), pt(20, 102), pt(30, 103), pt(40, 104)];
    const trend = e1rmTrend(points)!;
    expect(trend).not.toBeNull();
    expect(trend.slopeKgPerDay).toBeCloseTo(0.1, 10);
    expect(trend.currentKg).toBeCloseTo(104, 10);
    expect(trend.r2).toBeCloseTo(1, 10);
  });

  it("predicts along the line at any point in time", () => {
    const points = [pt(0, 100), pt(10, 101), pt(20, 102), pt(30, 103), pt(40, 104)];
    const trend = e1rmTrend(points)!;
    expect(trend.predictAt(day(0))).toBeCloseTo(100, 10);
    expect(trend.predictAt(day(20))).toBeCloseTo(102, 10);
    expect(trend.predictAt(day(100))).toBeCloseTo(110, 10); // extrapolates past the data
  });

  it("reports a low r2 for noisy, directionless data", () => {
    const points = [pt(0, 100), pt(10, 115), pt(20, 95), pt(30, 112), pt(40, 98)];
    const trend = e1rmTrend(points)!;
    expect(trend).not.toBeNull();
    expect(trend.r2).toBeLessThan(0.3);
  });

  it("detects a declining trend", () => {
    const points = [pt(0, 110), pt(10, 107), pt(20, 104), pt(30, 101), pt(40, 98)];
    const trend = e1rmTrend(points)!;
    expect(trend.slopeKgPerDay).toBeLessThan(0);
  });
});
