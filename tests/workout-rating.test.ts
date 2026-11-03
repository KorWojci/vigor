import { describe, expect, it } from "vitest";
import { buildWorkoutRatingContext, buildWorkoutRatingPrompt, workoutRatingResultSchema, type WorkoutRatingContext } from "@/lib/ai/workout-rating";
import { importHevyCsv } from "@/lib/training/hevy-import";
import { listWorkouts } from "@/lib/training/repo";
import { testDb } from "./helpers";

const TZ = "UTC";
const CSV_HEADER = "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe";

function row(title: string, start: string, end: string, exercise: string, weight: string, reps: string) {
  return `"${title}","${start}","${end}","","${exercise}","","",0,"normal","${weight}","${reps}","","",""`;
}

describe("buildWorkoutRatingContext", () => {
  it("flags a new personal best against prior sessions of the same exercise", () => {
    const db = testDb();
    const csv = [
      CSV_HEADER,
      row("Push A", "2026-09-01T18:00:00Z", "2026-09-01T18:30:00Z", "Bench Press (Barbell)", "70", "5"),
      row("Push B", "2026-09-08T18:00:00Z", "2026-09-08T18:30:00Z", "Bench Press (Barbell)", "72", "5"),
      row("Push C", "2026-09-15T18:00:00Z", "2026-09-15T18:30:00Z", "Bench Press (Barbell)", "80", "5"), // new best
    ].join("\n");
    importHevyCsv(db, csv, { tz: TZ });
    const latest = listWorkouts(db, 0, Date.now() * 2).find((w) => w.startMs === Date.parse("2026-09-15T18:00:00Z"))!;

    const ctx = buildWorkoutRatingContext(db, latest.id)!;
    expect(ctx.isStrength).toBe(true);
    expect(ctx.exercises[0]).toMatchObject({ name: "Bench Press (Barbell)", isNewPr: true });
    // Recent average volume excludes this session itself: (70*5 + 72*5) / 2 = 355.
    expect(ctx.avgRecentVolumeKg).toBeCloseTo(355, 5);
  });

  it("does not flag a PR when the session is lighter than a prior one", () => {
    const db = testDb();
    const csv = [
      CSV_HEADER,
      row("Push A", "2026-09-01T18:00:00Z", "2026-09-01T18:30:00Z", "Bench Press (Barbell)", "90", "5"),
      row("Push B", "2026-09-08T18:00:00Z", "2026-09-08T18:30:00Z", "Bench Press (Barbell)", "70", "5"),
    ].join("\n");
    importHevyCsv(db, csv, { tz: TZ });
    const latest = listWorkouts(db, 0, Date.now() * 2).find((w) => w.startMs === Date.parse("2026-09-08T18:00:00Z"))!;

    const ctx = buildWorkoutRatingContext(db, latest.id)!;
    expect(ctx.exercises[0].isNewPr).toBe(false);
  });

  it("returns null for a workout that doesn't exist", () => {
    const db = testDb();
    expect(buildWorkoutRatingContext(db, 999)).toBeNull();
  });
});

describe("buildWorkoutRatingPrompt", () => {
  const strengthCtx: WorkoutRatingContext = {
    activityType: null,
    title: "Push Day",
    startMs: Date.parse("2026-09-15T18:00:00Z"),
    durationS: 1800,
    isStrength: true,
    exercises: [{ name: "Bench Press", workingSets: 3, topSetWeightKg: 80, topSetReps: 5, bestE1rmKg: 93.3, isNewPr: true }],
    totalVolumeKg: 1200,
    avgRecentVolumeKg: 1000,
    distanceM: null,
    avgHr: null,
    avgRecentPaceSecPerKm: null,
    avgRecentDistanceM: null,
  };

  it("includes the exercise name, top set and whether it's a new PR", () => {
    const prompt = buildWorkoutRatingPrompt(strengthCtx, "metric", TZ);
    const json = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(json.exercises[0]).toMatchObject({ name: "Bench Press", topSet: "80 kg x 5", newPersonalBest: true });
  });

  it("converts to imperial units when requested", () => {
    const prompt = buildWorkoutRatingPrompt(strengthCtx, "imperial", TZ);
    expect(prompt).toContain("lb");
  });

  it("includes pace and recent-average comparisons for a cardio workout", () => {
    const cardioCtx: WorkoutRatingContext = {
      activityType: "running",
      title: null,
      startMs: Date.parse("2026-09-15T06:00:00Z"),
      durationS: 1500,
      isStrength: false,
      exercises: [],
      totalVolumeKg: 0,
      avgRecentVolumeKg: null,
      distanceM: 5000,
      avgHr: 150,
      avgRecentPaceSecPerKm: 330,
      avgRecentDistanceM: 4500,
    };
    const prompt = buildWorkoutRatingPrompt(cardioCtx, "metric", TZ);
    const json = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(json.type).toBe("running");
    expect(json.distance).toBe("5 km");
    expect(json.pace).toBe("5:00 / km");
    expect(json.recentAveragePace).toBe("5:30 / km");
  });
});

describe("workoutRatingResultSchema", () => {
  it("accepts a well-formed response", () => {
    expect(workoutRatingResultSchema.safeParse({ rating: "strong", summary: "New PR on bench." }).success).toBe(true);
  });

  it("rejects a rating outside the allowed set", () => {
    expect(workoutRatingResultSchema.safeParse({ rating: "amazing", summary: "x" }).success).toBe(false);
  });
});
