import { describe, expect, it } from "vitest";
import { cardioDetail, distanceSplits, hrZones, primarySource, type WindowSample } from "@/lib/training/cardio";

const T0 = Date.UTC(2026, 9, 22, 6, 0, 0);
const sample = (type: string, startS: number, durS: number, value: number, sourceName = "Watch"): WindowSample => ({
  type,
  startMs: T0 + startS * 1000,
  endMs: T0 + (startS + durS) * 1000,
  value,
  sourceName,
});

describe("cardio", () => {
  it("picks the source with the most data", () => {
    const s = [sample("heart_rate", 0, 0, 100, "Strap"), sample("heart_rate", 5, 0, 101, "Strap"), sample("heart_rate", 0, 0, 99, "Watch")];
    expect(primarySource(s)).toBe("Strap");
    expect(primarySource([sample("d", 0, 1, 900, "Watch"), sample("d", 0, 1, 50, "iPhone"), sample("d", 1, 1, 50, "iPhone")], true)).toBe("Watch");
  });

  it("credits time to heart-rate zones and caps gaps", () => {
    // max 200 → Z2 from 120, Z3 140, Z4 160, Z5 180
    const r = [
      { t: T0, bpm: 110 },
      { t: T0 + 10_000, bpm: 150 },
      { t: T0 + 20_000, bpm: 185 },
      { t: T0 + 600_000, bpm: 150 }, // 580 s gap before this → capped at 60 s for the 185 reading
    ];
    const z = hrZones(r, 200, T0 + 610_000);
    expect(z.map((x) => x.seconds)).toEqual([10, 0, 20, 0, 60]);
    expect(z[1]).toMatchObject({ fromBpm: 120, toBpm: 140 });
  });

  it("interpolates km splits and keeps a meaningful partial split", () => {
    // 250 m every 60 s → 1 km per 240 s; 2.5 km total
    const d = Array.from({ length: 10 }, (_, i) => sample("distance_walking_running", i * 60, 60, 250));
    const s = distanceSplits(d, T0, 1000);
    expect(s.map((x) => Math.round(x.distanceM))).toEqual([1000, 1000, 500]);
    expect(s.map((x) => Math.round(x.durationS))).toEqual([240, 240, 120]);
    // a 50 m tail (5% of a km) is dropped
    expect(distanceSplits([sample("d", 0, 60, 1050)], T0, 1000)).toHaveLength(1);
  });

  it("does not double count overlapping sources", () => {
    const samples = [
      sample("distance_walking_running", 0, 240, 1000, "Watch"),
      sample("distance_walking_running", 0, 240, 30, "iPhone"),
      sample("heart_rate", 10, 0, 140, "Watch"),
      sample("active_energy", 0, 60, 10, "Watch"),
      sample("active_energy", 60, 60, 12, "Watch"),
    ];
    const c = cardioDetail(samples, T0, T0 + 240_000, { maxHr: null, splitM: 1000, distanceM: 990 });
    expect(c.splits).toHaveLength(1);
    expect(c.splits[0].distanceM).toBe(1000);
    expect(c.zones).toBeNull();
    expect(c.hrMax).toBe(140);
    expect(c.energyPerMinute.slice(0, 2).map((e) => e.kcal)).toEqual([10, 12]);
    // no workout distance (strength training) → no splits
    expect(cardioDetail(samples, T0, T0 + 240_000, { maxHr: null, splitM: 1000, distanceM: null }).splits).toEqual([]);
  });
});
