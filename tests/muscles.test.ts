import { describe, expect, it } from "vitest";
import { addActivityLoad, addExerciseLoad, isAssumedActivity, normalizeLoad, zoneForMuscle, type ZoneLoad } from "@/lib/training/muscles";

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

describe("addExerciseLoad / normalizeLoad", () => {
  it("returns nothing for an empty accumulator", () => {
    expect(normalizeLoad({})).toEqual({});
  });

  it("weights target muscles above secondary ones and normalises to the max", () => {
    const raw: ZoneLoad = {};
    addExerciseLoad(raw, { workingSets: 4, targetMuscles: ["pectorals"], secondaryMuscles: ["triceps"] });
    const result = normalizeLoad(raw);
    expect(result.chest).toBe(1); // the most-worked zone is always 1
    expect(result.triceps).toBeCloseTo(0.5, 5); // secondary muscles count half
  });

  it("accumulates across exercises (and, by extension, workouts) and weights by working sets", () => {
    const raw: ZoneLoad = {};
    addExerciseLoad(raw, { workingSets: 3, targetMuscles: ["pectorals"], secondaryMuscles: [] });
    addExerciseLoad(raw, { workingSets: 1, targetMuscles: ["triceps"], secondaryMuscles: [] });
    const result = normalizeLoad(raw);
    expect(result.chest).toBe(1);
    expect(result.triceps).toBeCloseTo(1 / 3, 5);
  });

  it("omits zones with zero involvement instead of rendering a fabricated zero", () => {
    const raw: ZoneLoad = {};
    addExerciseLoad(raw, { workingSets: 2, targetMuscles: ["pectorals"], secondaryMuscles: [] });
    expect(normalizeLoad(raw).quadriceps).toBeUndefined();
  });
});

describe("addActivityLoad / isAssumedActivity", () => {
  it("recognises common non-strength activities", () => {
    expect(isAssumedActivity("Running")).toBe(true);
    expect(isAssumedActivity("Outdoor Walk")).toBe(true);
    expect(isAssumedActivity("Yoga")).toBe(true);
  });

  it("does nothing for an activity type it doesn't recognise, rather than guessing", () => {
    const raw: ZoneLoad = {};
    addActivityLoad(raw, "Underwater Basket Weaving", 3600);
    expect(raw).toEqual({});
    expect(isAssumedActivity("Underwater Basket Weaving")).toBe(false);
  });

  it("scales by duration, capped at 3 hours", () => {
    const oneHour: ZoneLoad = {};
    addActivityLoad(oneHour, "Running", 3600);
    const twoHours: ZoneLoad = {};
    addActivityLoad(twoHours, "Running", 7200);
    expect(twoHours.quadriceps).toBeCloseTo(oneHour.quadriceps! * 2, 5);

    const cappedAtThree: ZoneLoad = {};
    addActivityLoad(cappedAtThree, "Running", 36000); // 10h, should behave like 3h
    const threeHours: ZoneLoad = {};
    addActivityLoad(threeHours, "Running", 3 * 3600);
    expect(cappedAtThree.quadriceps).toBeCloseTo(threeHours.quadriceps!, 5);
  });

  it("does nothing for zero or negative duration", () => {
    const raw: ZoneLoad = {};
    addActivityLoad(raw, "Running", 0);
    expect(raw).toEqual({});
  });
});
