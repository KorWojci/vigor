import { describe, expect, it } from "vitest";
import { ACTIVITY_LEVELS, classifyActivityLevel, estimateTdee, mifflinStJeorBmr, planWeightGoal } from "@/lib/health/calorie-goal";

describe("mifflinStJeorBmr", () => {
  it("computes the male and female formulas", () => {
    expect(mifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "male" })).toBeCloseTo(1780, 5);
    expect(mifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "female" })).toBeCloseTo(1614, 5);
  });

  it("returns null without height, age or a male/female sex, rather than guessing", () => {
    expect(mifflinStJeorBmr({ weightKg: 80, heightCm: null, age: 30, sex: "male" })).toBeNull();
    expect(mifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: null, sex: "male" })).toBeNull();
    expect(mifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "unspecified" })).toBeNull();
    expect(mifflinStJeorBmr({ weightKg: 80, heightCm: 180, age: 30, sex: "other" })).toBeNull();
  });
});

describe("estimateTdee", () => {
  const base = { weightKg: 80, heightCm: 180, age: 30, sex: "male" as const, activityLevel: "moderate" as const };

  it("prefers measured basal and active energy when both are available", () => {
    const r = estimateTdee({ ...base, measuredBasalKcal: 1700, measuredActiveKcal: 500 });
    expect(r.basalSource).toBe("measured");
    expect(r.activeSource).toBe("measured");
    expect(r.tdeeKcal).toBe(2200);
  });

  it("falls back to the formula per-component when a measured average is missing", () => {
    const r = estimateTdee({ ...base, measuredBasalKcal: null, measuredActiveKcal: 500 });
    expect(r.basalSource).toBe("formula");
    expect(r.basalKcal).toBeCloseTo(1780, 5);
    expect(r.activeSource).toBe("measured");
    expect(r.tdeeKcal).toBeCloseTo(2280, 5);
  });

  it("uses the activity multiplier on top of BMR when nothing is measured", () => {
    const sedentary = estimateTdee({ ...base, activityLevel: "sedentary", measuredBasalKcal: null, measuredActiveKcal: null });
    expect(sedentary.activeSource).toBe("formula");
    // sedentary multiplier is 1.2, so active = bmr * 0.2
    expect(sedentary.tdeeKcal).toBeCloseTo(1780 * 1.2, 4);
  });

  it("returns nulls when BMR can't be computed and nothing is measured", () => {
    const r = estimateTdee({ ...base, heightCm: null, measuredBasalKcal: null, measuredActiveKcal: null });
    expect(r.bmrKcal).toBeNull();
    expect(r.basalKcal).toBeNull();
    expect(r.activeKcal).toBeNull();
    expect(r.tdeeKcal).toBeNull();
  });

  it("covers every declared activity level", () => {
    expect(ACTIVITY_LEVELS).toHaveLength(5);
    expect(ACTIVITY_LEVELS.map((l) => l.key)).toEqual(["sedentary", "light", "moderate", "active", "very_active"]);
  });
});

describe("classifyActivityLevel", () => {
  it("bands by average daily steps alone", () => {
    expect(classifyActivityLevel({ avgStepsPerDay: 3000, avgExerciseMinPerWeek: null })).toBe("sedentary");
    expect(classifyActivityLevel({ avgStepsPerDay: 6000, avgExerciseMinPerWeek: null })).toBe("light");
    expect(classifyActivityLevel({ avgStepsPerDay: 8500, avgExerciseMinPerWeek: null })).toBe("moderate");
    expect(classifyActivityLevel({ avgStepsPerDay: 11000, avgExerciseMinPerWeek: null })).toBe("active");
    expect(classifyActivityLevel({ avgStepsPerDay: 13000, avgExerciseMinPerWeek: null })).toBe("very_active");
  });

  it("bands by average weekly exercise minutes alone", () => {
    expect(classifyActivityLevel({ avgStepsPerDay: null, avgExerciseMinPerWeek: 10 })).toBe("sedentary");
    expect(classifyActivityLevel({ avgStepsPerDay: null, avgExerciseMinPerWeek: 100 })).toBe("light");
    expect(classifyActivityLevel({ avgStepsPerDay: null, avgExerciseMinPerWeek: 200 })).toBe("moderate");
    expect(classifyActivityLevel({ avgStepsPerDay: null, avgExerciseMinPerWeek: 320 })).toBe("active");
    expect(classifyActivityLevel({ avgStepsPerDay: null, avgExerciseMinPerWeek: 500 })).toBe("very_active");
  });

  it("takes the more active of the two signals when both are present", () => {
    // low steps (sedentary) but a heavy training habit (active) — the training should win
    expect(classifyActivityLevel({ avgStepsPerDay: 3000, avgExerciseMinPerWeek: 320 })).toBe("active");
    // lots of walking (very_active) but no formal exercise (sedentary) — the steps should win
    expect(classifyActivityLevel({ avgStepsPerDay: 13000, avgExerciseMinPerWeek: 10 })).toBe("very_active");
  });

  it("returns null when neither signal has enough data, rather than guessing", () => {
    expect(classifyActivityLevel({ avgStepsPerDay: null, avgExerciseMinPerWeek: null })).toBeNull();
  });
});

describe("planWeightGoal", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("derives a deficit when the target is below the current weight", () => {
    const plan = planWeightGoal({ currentWeightKg: 90, targetWeightKg: 80, weeklyRateKg: 0.5, tdeeKcal: 2500, bmrKcal: 1700, sex: "male", nowMs: now });
    expect(plan.dailyDeltaKcal).toBeCloseTo(-550, 5); // -0.5*7700/7
    expect(plan.dailyTargetKcal).toBeCloseTo(1950, 5);
    expect(plan.weeksToGoal).toBeCloseTo(20, 5); // 10kg / 0.5kg/week
    expect(plan.projectedAtMs).toBe(now + 20 * 7 * 86_400_000);
  });

  it("derives a surplus when the target is above the current weight", () => {
    const plan = planWeightGoal({ currentWeightKg: 70, targetWeightKg: 75, weeklyRateKg: 0.5, tdeeKcal: 2500, bmrKcal: 1700, sex: "male", nowMs: now });
    expect(plan.dailyDeltaKcal).toBeCloseTo(550, 5);
    expect(plan.dailyTargetKcal).toBeCloseTo(3050, 5);
  });

  it("is a no-op maintenance plan when already at the target", () => {
    const plan = planWeightGoal({ currentWeightKg: 75, targetWeightKg: 75, weeklyRateKg: 0.5, tdeeKcal: 2500, bmrKcal: 1700, sex: "male", nowMs: now });
    expect(plan.dailyDeltaKcal).toBe(0);
    expect(plan.dailyTargetKcal).toBe(2500);
    expect(plan.weeksToGoal).toBe(0);
  });

  it("never resolves a date when the rate is zero but the goal isn't reached", () => {
    const plan = planWeightGoal({ currentWeightKg: 90, targetWeightKg: 80, weeklyRateKg: 0, tdeeKcal: 2500, bmrKcal: 1700, sex: "male", nowMs: now });
    expect(plan.weeksToGoal).toBeNull();
    expect(plan.projectedAtMs).toBeNull();
  });

  it("warns when the target dips below the safe BMR-based floor", () => {
    const plan = planWeightGoal({ currentWeightKg: 90, targetWeightKg: 80, weeklyRateKg: 1.5, tdeeKcal: 2000, bmrKcal: 1700, sex: "male", nowMs: now });
    // target = 2000 - 1650 = 350, well under 1.2*1700=2040
    expect(plan.safeMinSource).toBe("bmr");
    expect(plan.warnings.some((w) => w.includes("below a safe minimum"))).toBe(true);
  });

  it("falls back to the sex-based absolute floor when BMR is unavailable", () => {
    const plan = planWeightGoal({ currentWeightKg: 90, targetWeightKg: 80, weeklyRateKg: 0.25, tdeeKcal: 1300, bmrKcal: null, sex: "female", nowMs: now });
    expect(plan.safeMinSource).toBe("absolute");
    expect(plan.safeMinKcal).toBe(1200);
  });

  it("warns when the requested pace is faster than ~1 kg/week", () => {
    const plan = planWeightGoal({ currentWeightKg: 90, targetWeightKg: 70, weeklyRateKg: 1.2, tdeeKcal: 3000, bmrKcal: 1700, sex: "male", nowMs: now });
    expect(plan.warnings.some((w) => w.includes("faster than"))).toBe(true);
  });

  it("doesn't warn for a slow, safe pace with plenty of headroom", () => {
    const plan = planWeightGoal({ currentWeightKg: 90, targetWeightKg: 85, weeklyRateKg: 0.5, tdeeKcal: 2800, bmrKcal: 1700, sex: "male", nowMs: now });
    expect(plan.warnings).toEqual([]);
  });
});
