import { describe, expect, it } from "vitest";
import { toCanonical, toDisplay, fromDisplay, formatDuration } from "@/lib/units";
import { dayKey, startOfDayMs, zonedWallTimeToUtc, rangeFromDays, previousRange } from "@/lib/time";

describe("units", () => {
  it("converts to canonical units", () => {
    expect(toCanonical(1, "mi", "m")).toBeCloseTo(1609.344);
    expect(toCanonical(98.6, "degF", "°c")).toBeCloseTo(37);
    expect(toCanonical(5.5, "mmol/L", "mg/dl")).toBeCloseTo(99.1, 1);
    expect(toCanonical(1, "furlong", "m")).toBeNull();
  });
  it("round-trips display units", () => {
    const d = toDisplay(80, "kg", "imperial");
    expect(d.unit).toBe("lb");
    expect(fromDisplay(d.value, "kg", "imperial")).toBeCloseTo(80);
    expect(toDisplay(180, "cm", "imperial").value).toBeCloseTo(70.87, 1);
  });
  it("formats durations", () => {
    expect(formatDuration(452)).toBe("7 h 32 min");
    expect(formatDuration(45)).toBe("45 min");
  });
});

describe("time", () => {
  it("handles DST when converting wall time", () => {
    // Europe/Warsaw switches from CEST (+2) to CET (+1) on 2026-10-25.
    expect(zonedWallTimeToUtc(2026, 10, 24, 12, 0, 0, "Europe/Warsaw")).toBe(Date.parse("2026-10-24T10:00:00Z"));
    expect(zonedWallTimeToUtc(2026, 10, 26, 12, 0, 0, "Europe/Warsaw")).toBe(Date.parse("2026-10-26T11:00:00Z"));
    expect(startOfDayMs("2026-10-20", "America/New_York")).toBe(Date.parse("2026-10-20T04:00:00Z"));
  });
  it("builds ranges and previous ranges", () => {
    const r = rangeFromDays(7, "UTC", Date.parse("2026-10-20T12:00:00Z"));
    expect(r).toMatchObject({ from: "2026-10-14", to: "2026-10-20", days: 7 });
    expect(previousRange(r, "UTC")).toMatchObject({ from: "2026-10-07", to: "2026-10-13" });
    expect(dayKey(r.endMs - 1, "UTC")).toBe("2026-10-20");
  });
});
