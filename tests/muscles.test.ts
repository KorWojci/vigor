import { describe, expect, it } from "vitest";
import { musclesTrained, zoneForMuscle } from "@/lib/training/muscles";

describe("zoneForMuscle", () => {
  it("maps known ExerciseDB muscle names to a zone", () => {
    expect(zoneForMuscle("pectorals")).toBe("chest");
    expect(zoneForMuscle("Latissimus Dorsi")).toBe("lats");
  });

  it("has no zone for cardio, which isn't a drawable muscle", () => {
    expect(zoneForMuscle("cardiovascular system")).toBeUndefined();
  });

  it("returns undefined for an unknown name rather than guessing", () => {
    expect(zoneForMuscle("not a muscle")).toBeUndefined();
  });
});

describe("musclesTrained", () => {
  it("returns nothing for an empty workout", () => {
    expect(musclesTrained([])).toEqual({});
  });

  it("weights target muscles above secondary ones and normalises to the max", () => {
    const result = musclesTrained([{ workingSets: 4, targetMuscles: ["pectorals"], secondaryMuscles: ["triceps"] }]);
    expect(result.chest).toBe(1); // the most-worked zone is always 1
    expect(result.triceps).toBeCloseTo(0.5, 5); // secondary muscles count half
  });

  it("accumulates across exercises and weights by working sets", () => {
    const result = musclesTrained([
      { workingSets: 3, targetMuscles: ["pectorals"], secondaryMuscles: [] },
      { workingSets: 1, targetMuscles: ["triceps"], secondaryMuscles: [] },
    ]);
    expect(result.chest).toBe(1);
    expect(result.triceps).toBeCloseTo(1 / 3, 5);
  });

  it("omits zones with zero involvement instead of rendering a fabricated zero", () => {
    const result = musclesTrained([{ workingSets: 2, targetMuscles: ["pectorals"], secondaryMuscles: [] }]);
    expect(result.quadriceps).toBeUndefined();
  });
});
