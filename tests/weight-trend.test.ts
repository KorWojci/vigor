import { describe, expect, it } from "vitest";
import { weightTrend, type WeightPoint } from "@/lib/health/weight-trend";

const day = (n: number) => n * 86_400_000;
const pt = (dayOffset: number, weightKg: number): WeightPoint => ({ atMs: day(dayOffset), weightKg });

describe("weightTrend", () => {
  it("returns null with fewer than 5 readings", () => {
    expect(weightTrend([pt(0, 80), pt(5, 79.8), pt(10, 79.5), pt(15, 79.2)])).toBeNull();
  });

  it("returns null when the readings span under 14 days", () => {
    expect(weightTrend([pt(0, 80), pt(1, 79.9), pt(2, 79.8), pt(3, 79.7), pt(4, 79.6)])).toBeNull();
  });

  it("recovers a losing trend with a good fit", () => {
    // Losing 0.1 kg/day over 40 days.
    const points = [pt(0, 90), pt(10, 89), pt(20, 88), pt(30, 87), pt(40, 86)];
    const trend = weightTrend(points)!;
    expect(trend).not.toBeNull();
    expect(trend.slopeKgPerDay).toBeCloseTo(-0.1, 10);
    expect(trend.currentKg).toBeCloseTo(86, 10);
    expect(trend.r2).toBeCloseTo(1, 10);
  });

  it("projects a future date the trend reaches a target weight", () => {
    const points = [pt(0, 90), pt(10, 89), pt(20, 88), pt(30, 87), pt(40, 86)];
    const trend = weightTrend(points)!;
    // At -0.1 kg/day from 86kg (day 40), reaching 80kg takes 60 more days → day 100.
    expect(trend.dateToReach(80)).toBe(day(100));
  });

  it("returns no forecast date when the target is the wrong direction from the trend", () => {
    const points = [pt(0, 90), pt(10, 89), pt(20, 88), pt(30, 87), pt(40, 86)]; // losing
    const trend = weightTrend(points)!;
    expect(trend.dateToReach(95)).toBeNull(); // gaining target while actually losing
  });

  it("returns no forecast date for an exactly flat trend", () => {
    const points = [pt(0, 80), pt(10, 80), pt(20, 80), pt(30, 80), pt(40, 80)];
    const trend = weightTrend(points)!;
    expect(trend.slopeKgPerDay).toBe(0);
    expect(trend.dateToReach(75)).toBeNull();
  });
});
