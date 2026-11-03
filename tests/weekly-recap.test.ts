import { describe, expect, it } from "vitest";
import { buildPrompt, buildTrainingPrompt, buildWeeklyRecapInput, weeklyRecapResultSchema, weeklyTrainingRecapResultSchema, type WeeklyRecapInput } from "@/lib/ai/weekly-recap";
import { getWeeklyRecap, saveWeeklyRecap } from "@/lib/ai/repo";
import { importHevyCsv } from "@/lib/training/hevy-import";
import { addDays, weekStart } from "@/lib/time";
import { doImport, envelope, testDb } from "./helpers";

const TZ = "UTC";

const CSV_HEADER = "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe";

describe("buildWeeklyRecapInput", () => {
  it("gathers a week's training (strength + cardio), sleep and nutrition from the real tables", () => {
    const db = testDb();
    const weekStartDay = weekStart(Date.parse("2026-10-21T12:00:00Z"), TZ); // a Wednesday → Monday of that week

    // A strength session on the Monday of the week.
    const csv = [
      CSV_HEADER,
      `"Push Day","${weekStartDay}T18:00:00Z","${weekStartDay}T18:45:00Z","","Bench Press (Barbell)","","",0,"normal","80","5","","",""`,
    ].join("\n");
    expect(importHevyCsv(db, csv, { tz: TZ }).accepted).toBe(1);

    // A run on the Wednesday of the week.
    const runDay = addDays(weekStartDay, 2);
    doImport(
      db,
      envelope({
        workouts: [{ activityType: "running", startAt: `${runDay}T06:00:00Z`, endAt: `${runDay}T06:30:00Z`, distanceMeters: 5000, avgHeartRate: 150, externalId: "run1" }],
      }),
    );

    // One night of staged sleep ending on the Tuesday.
    doImport(
      db,
      envelope({
        samples: [
          { type: "sleep_analysis", category: "asleep_core", startAt: `${weekStartDay}T22:00:00Z`, endAt: `${weekStartDay}T23:00:00Z` },
          { type: "sleep_analysis", category: "asleep_deep", startAt: `${weekStartDay}T23:00:00Z`, endAt: `${weekStartDay}T23:30:00Z` },
        ],
      }),
    );

    // One day of logged nutrition.
    doImport(
      db,
      envelope({
        samples: [{ type: "dietary_energy", value: 2200, unit: "kcal", startAt: `${weekStartDay}T12:00:00Z`, endAt: `${weekStartDay}T12:00:00Z` }],
      }),
    );

    const input = buildWeeklyRecapInput(db, weekStartDay, TZ);

    expect(input.training.workoutCount).toBe(2);
    expect(input.training.strength).toHaveLength(1);
    expect(input.training.strength[0].exercises[0]).toMatchObject({ name: "Bench Press (Barbell)", workingSets: 1, topSetWeightKg: 80, topSetReps: 5 });
    expect(input.training.cardio).toHaveLength(1);
    expect(input.training.cardio[0]).toMatchObject({ activityType: "running", distanceM: 5000 });

    expect(input.sleep.nights).toHaveLength(1);
    expect(input.sleep.nights[0]).toMatchObject({ asleepMinutes: expect.closeTo(90, 1), deepMinutes: expect.closeTo(30, 1) });
    expect(input.sleep.avgAsleepMinutes).toBeCloseTo(90, 5);

    expect(input.nutrition.daysLogged).toBe(1);
    expect(input.nutrition.avgKcal).toBeCloseTo(2200, 5);
  });

  it("returns empty/null sections for a week with nothing logged, rather than fabricating", () => {
    const db = testDb();
    const input = buildWeeklyRecapInput(db, "2026-01-05", TZ);
    expect(input.training).toMatchObject({ workoutCount: 0, strength: [], cardio: [] });
    expect(input.sleep.nights).toEqual([]);
    expect(input.sleep.avgAsleepMinutes).toBeNull();
    expect(input.nutrition.daysLogged).toBe(0);
    expect(input.weightChangeKg).toBeNull();
  });
});

describe("buildPrompt", () => {
  const baseInput: WeeklyRecapInput = {
    weekStart: "2026-10-19",
    weekEnd: "2026-10-25",
    training: {
      workoutCount: 1,
      totalDurationS: 2700,
      strength: [{ day: "2026-10-19", title: "Push Day", exercises: [{ name: "Bench Press", workingSets: 3, topSetWeightKg: 80, topSetReps: 5, bestE1rmKg: 93.3 }] }],
      cardio: [],
    },
    sleep: {
      nights: [{ date: "2026-10-19", asleepMinutes: 420, deepMinutes: 60, remMinutes: 90, coreMinutes: 270, bedtimeMs: Date.parse("2026-10-19T22:00:00Z"), wakeMs: Date.parse("2026-10-20T05:30:00Z") }],
      avgAsleepMinutes: 420,
    },
    nutrition: { daysLogged: 5, avgKcal: 2200, avgProteinG: 140, avgCarbsG: 220, avgFatG: 70 },
    weightChangeKg: -0.5,
  };

  it("converts kg to the requested display unit", () => {
    const metric = buildPrompt(baseInput, "metric", TZ);
    expect(metric).toContain("80 kg x 5");
    const imperial = buildPrompt(baseInput, "imperial", TZ);
    expect(imperial).toContain("176.4 lb x 5");
    expect(imperial).toContain("lb");
  });

  it("includes the actual exercise name and session date, not just a count", () => {
    const prompt = buildPrompt(baseInput, "metric", TZ);
    expect(prompt).toContain("Bench Press");
    expect(prompt).toContain("2026-10-19");
  });

  it("includes a per-night sleep entry with bedtime/wake clock times", () => {
    const prompt = buildPrompt(baseInput, "metric", TZ);
    const json = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(json.sleep.nights).toHaveLength(1);
    expect(json.sleep.nights[0]).toMatchObject({ date: "2026-10-19", bedtime: "22:00", wake: "05:30" });
  });

  it("passes nulls/empties through for missing categories instead of inventing a value", () => {
    const empty: WeeklyRecapInput = {
      weekStart: "2026-10-19",
      weekEnd: "2026-10-25",
      training: { workoutCount: 0, totalDurationS: 0, strength: [], cardio: [] },
      sleep: { nights: [], avgAsleepMinutes: null },
      nutrition: { daysLogged: 0, avgKcal: null, avgProteinG: null, avgCarbsG: null, avgFatG: null },
      weightChangeKg: null,
    };
    const prompt = buildPrompt(empty, "metric", TZ);
    const json = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(json.training.totalWorkouts).toBe(0);
    expect(json.sleep.nights).toEqual([]);
    expect(json.nutrition.avgDailyKcal).toBeNull();
    expect(json.weightChange).toBeNull();
  });
});

describe("buildTrainingPrompt", () => {
  it("includes training facts but no sleep or nutrition data at all", () => {
    const training: WeeklyRecapInput["training"] = {
      workoutCount: 1,
      totalDurationS: 2700,
      strength: [{ day: "2026-10-19", title: "Push Day", exercises: [{ name: "Bench Press", workingSets: 3, topSetWeightKg: 80, topSetReps: 5, bestE1rmKg: 93.3 }] }],
      cardio: [],
    };
    const prompt = buildTrainingPrompt(training, "2026-10-19", "2026-10-25", "metric");
    const json = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(json.training.strengthSessions[0].exercises[0].name).toBe("Bench Press");
    expect(json.sleep).toBeUndefined();
    expect(json.nutrition).toBeUndefined();
  });
});

describe("weeklyTrainingRecapResultSchema", () => {
  it("accepts a response with no sleepByNight field", () => {
    const result = weeklyTrainingRecapResultSchema.safeParse({
      summary: "A solid week of training.",
      goodThings: ["Hit a new bench press PR."],
      badThings: [],
      suggestion: "Add a fourth session next week.",
    });
    expect(result.success).toBe(true);
  });
});

describe("weeklyRecapResultSchema", () => {
  it("accepts a well-formed model response", () => {
    const result = weeklyRecapResultSchema.safeParse({
      summary: "A solid week.",
      goodThings: ["Hit a new bench press PR."],
      badThings: [],
      suggestion: "Try adding a third run next week.",
      sleepByNight: [{ date: "2026-10-19", note: "Good 7-hour night." }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a response missing required fields", () => {
    expect(weeklyRecapResultSchema.safeParse({ summary: "Missing everything else." }).success).toBe(false);
  });
});

describe("weekly_recaps repo", () => {
  it("round-trips a saved recap and upserts on regenerate", () => {
    const db = testDb();
    expect(getWeeklyRecap(db, "2026-10-19", "full")).toBeNull();
    saveWeeklyRecap(db, { weekStart: "2026-10-19", scope: "full", generatedAt: 1000, model: "gemini-3.1-flash-lite", content: "First.", prompt: "p1" });
    expect(getWeeklyRecap(db, "2026-10-19", "full")).toMatchObject({ content: "First.", prompt: "p1" });
    saveWeeklyRecap(db, { weekStart: "2026-10-19", scope: "full", generatedAt: 2000, model: "gemini-3.1-flash-lite", content: "Regenerated.", prompt: "p2" });
    const recap = getWeeklyRecap(db, "2026-10-19", "full");
    expect(recap).toMatchObject({ content: "Regenerated.", prompt: "p2", generatedAt: 2000 });
  });

  it("keeps the full and training scopes separate for the same week", () => {
    const db = testDb();
    saveWeeklyRecap(db, { weekStart: "2026-10-19", scope: "full", generatedAt: 1000, model: "m", content: "Full recap.", prompt: "p" });
    saveWeeklyRecap(db, { weekStart: "2026-10-19", scope: "training", generatedAt: 1000, model: "m", content: "Training recap.", prompt: "p" });
    expect(getWeeklyRecap(db, "2026-10-19", "full")?.content).toBe("Full recap.");
    expect(getWeeklyRecap(db, "2026-10-19", "training")?.content).toBe("Training recap.");
  });
});
