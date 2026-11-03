import { describe, expect, it } from "vitest";
import { MIN_EFFORT_M, predictRaceTimes, RACE_DISTANCES, riegelPredict, type RunEffort } from "@/lib/training/race-predict";

describe("riegelPredict", () => {
  it("applies the Riegel formula (T2 = T1 × (D2/D1)^1.06)", () => {
    expect(riegelPredict(5000, 1200, 10000)).toBeCloseTo(1200 * 2 ** 1.06, 6);
  });

  it("predicts the same duration when the target equals the known distance", () => {
    expect(riegelPredict(10000, 2400, 10000)).toBe(2400);
  });

  it("predicts more than double the time for double the distance (fatigue factor > 1)", () => {
    const predicted = riegelPredict(5000, 1200, 10000);
    expect(predicted).toBeGreaterThan(2400);
  });
});

describe("predictRaceTimes", () => {
  const effort = (distanceM: number, durationS: number, workoutId = 1, startMs = 0): RunEffort => ({ workoutId, distanceM, durationS, startMs });

  it("ignores runs shorter than the minimum qualifying distance", () => {
    const result = predictRaceTimes([effort(MIN_EFFORT_M - 1, 300)]);
    expect(result.every((r) => r.predictedS === null)).toBe(true);
  });

  it("returns null predictions when there are no qualifying runs", () => {
    const result = predictRaceTimes([]);
    expect(result).toHaveLength(RACE_DISTANCES.length);
    for (const r of result) {
      expect(r.predictedS).toBeNull();
      expect(r.basedOn).toBeNull();
      expect(r.confidence).toBeNull();
    }
  });

  it("picks whichever qualifying run implies the fastest time for each distance", () => {
    // A strong 5K (fast pace, short) and a slower, longer 10K.
    const fast5k = effort(5000, 1100, 1); // ~3:40/km
    const slow10k = effort(10000, 3000, 2); // 5:00/km
    const result = predictRaceTimes([fast5k, slow10k]);
    const tenK = result.find((r) => r.distance.key === "10k")!;
    // The fast 5K, extrapolated, predicts a faster 10K than the actual slow 10K run.
    expect(tenK.basedOn?.workoutId).toBe(1);
    expect(tenK.predictedS!).toBeLessThan(slow10k.durationS);
  });

  it("gives high confidence when the source distance is close to the target, low when it's far", () => {
    const result = predictRaceTimes([effort(10000, 2400, 1)]);
    const tenK = result.find((r) => r.distance.key === "10k")!;
    const marathon = result.find((r) => r.distance.key === "marathon")!;
    expect(tenK.confidence).toBe("high");
    expect(marathon.confidence).toBe("low");
  });

  it("is exact (and high confidence) when a logged run matches the target distance", () => {
    const result = predictRaceTimes([effort(21097.5, 6300, 1)]);
    const half = result.find((r) => r.distance.key === "half")!;
    expect(half.predictedS).toBe(6300);
    expect(half.confidence).toBe("high");
  });
});
