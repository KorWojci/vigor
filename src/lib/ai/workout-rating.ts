import { z } from "zod";
import type { DB } from "../db";
import { callGemini, parseJsonResponse } from "./gemini";
import { getExerciseHistory, getWorkout, listWorkouts } from "../training/repo";
import { dayKey } from "../time";
import { toDisplay, type UnitSystem } from "../units";

/**
 * Per-workout AI rating — same exception as the weekly recap (CLAUDE.md invariant 9), same
 * explicit-trigger-only rule. The "rating" is grounded in facts Vigor itself computes (recent
 * averages, whether a set is a new personal best) rather than left for the model to judge from
 * nothing; the model only classifies and narrates.
 */

export const WORKOUT_RATING_LABELS = ["strong", "solid", "light", "off"] as const;
export type WorkoutRatingLabel = (typeof WORKOUT_RATING_LABELS)[number];

export interface RatedExercise {
  name: string;
  workingSets: number;
  topSetWeightKg: number | null;
  topSetReps: number | null;
  bestE1rmKg: number | null;
  isNewPr: boolean;
}

export interface WorkoutRatingContext {
  activityType: string | null;
  title: string | null;
  startMs: number;
  durationS: number | null;
  isStrength: boolean;
  exercises: RatedExercise[]; // strength only
  totalVolumeKg: number;
  /** Average session volume of the athlete's recent strength sessions, excluding this one — null if there's no history to compare against. */
  avgRecentVolumeKg: number | null;
  distanceM: number | null; // cardio only
  avgHr: number | null;
  avgRecentPaceSecPerKm: number | null; // cardio only, same activity type
  avgRecentDistanceM: number | null;
}

const RECENT_LOOKBACK_MS = 120 * 86_400_000;
const RECENT_SAMPLE_SIZE = 8;

/** Gathers one workout's own data plus Vigor-computed comparisons (PRs, recent averages) — no judgement, just facts. */
export function buildWorkoutRatingContext(db: DB, workoutId: number): WorkoutRatingContext | null {
  const w = getWorkout(db, workoutId);
  if (!w) return null;
  const isStrength = w.exerciseCount > 0;
  const priorWorkouts = listWorkouts(db, w.startMs - RECENT_LOOKBACK_MS, w.startMs).filter((p) => p.id !== w.id);

  let exercises: RatedExercise[] = [];
  let avgRecentVolumeKg: number | null = null;
  if (isStrength) {
    exercises = w.exercises.map((e) => {
      const history = getExerciseHistory(db, e.exerciseId);
      const priorBest = history ? Math.max(0, ...history.sessions.filter((s) => s.workoutId !== workoutId).map((s) => s.stats.bestE1RM ?? 0)) : 0;
      const bestE1rmKg = e.stats.bestE1RM;
      return {
        name: e.name,
        workingSets: e.stats.workingSets,
        topSetWeightKg: e.stats.topSet?.weightKg ?? null,
        topSetReps: e.stats.topSet?.reps ?? null,
        bestE1rmKg,
        isNewPr: bestE1rmKg != null && bestE1rmKg > priorBest,
      };
    });
    const priorStrength = priorWorkouts.filter((p) => p.exerciseCount > 0).slice(-RECENT_SAMPLE_SIZE);
    avgRecentVolumeKg = priorStrength.length ? priorStrength.reduce((a, p) => a + p.volumeKg, 0) / priorStrength.length : null;
  }

  let avgRecentPaceSecPerKm: number | null = null;
  let avgRecentDistanceM: number | null = null;
  if (!isStrength && w.activityType) {
    const priorSame = priorWorkouts.filter((p) => p.activityType === w.activityType && p.distanceM && p.durationS).slice(-RECENT_SAMPLE_SIZE);
    if (priorSame.length) {
      avgRecentDistanceM = priorSame.reduce((a, p) => a + p.distanceM!, 0) / priorSame.length;
      const paces = priorSame.map((p) => p.durationS! / (p.distanceM! / 1000));
      avgRecentPaceSecPerKm = paces.reduce((a, b) => a + b, 0) / paces.length;
    }
  }

  return {
    activityType: w.activityType,
    title: w.title,
    startMs: w.startMs,
    durationS: w.durationS,
    isStrength,
    exercises,
    totalVolumeKg: w.volumeKg,
    avgRecentVolumeKg,
    distanceM: w.distanceM,
    avgHr: w.avgHr ?? w.linked?.avgHr ?? null,
    avgRecentPaceSecPerKm,
    avgRecentDistanceM,
  };
}

export const WORKOUT_RATING_SYSTEM_INSTRUCTIONS = `You are a concise, factual fitness assistant inside a personal health-tracking app called Vigor. You will be given one workout's own logged data as JSON, including objective comparisons the app already computed (recent averages, whether a set was a new personal best) — never recompute, second-guess or contradict those numbers yourself. Respond with ONLY a single JSON object (no markdown fences, no extra text) matching exactly this shape:

{
  "rating": "strong" | "solid" | "light" | "off",
  "summary": string  // 2-4 sentences, plain prose
}

Rating guide:
- "strong": a new personal best, or clearly more volume/distance/intensity than the athlete's recent average.
- "solid": a normal, productive session — in line with the recent average, nothing exceptional either way.
- "light": clearly lower volume/distance/duration than the recent average (e.g. a deload, a short or easy session).
- "off": notably below the recent pattern in a way that might be worth noticing (not necessarily bad — could be intentional).

Rules:
- Only state facts present in the JSON you are given. Never invent a number, exercise name or comparison that isn't there.
- Name the actual exercises or activity in "summary", not just a generic description.
- Do not give medical advice, do not diagnose, and do not be judgemental — this is the user's own data.
- If there isn't enough comparison data to judge against a recent average, say so in "summary" and default to "solid" rather than guessing a direction.
- Output must be valid JSON and nothing else.`;

export const workoutRatingResultSchema = z.object({
  rating: z.enum(WORKOUT_RATING_LABELS),
  summary: z.string().min(1),
});
export type WorkoutRatingResult = z.infer<typeof workoutRatingResultSchema>;

function paceString(secPerKm: number | null, units: UnitSystem, du: string): string | null {
  if (secPerKm == null) return null;
  const secPerUnit = units === "imperial" ? secPerKm * 1.609344 : secPerKm;
  const s = Math.round(secPerUnit);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} / ${du}`;
}

/** Pure and testable: no network, no DB. */
export function buildWorkoutRatingPrompt(ctx: WorkoutRatingContext, units: UnitSystem, tz: string): string {
  const mu = units === "imperial" ? "lb" : "kg";
  const du = units === "imperial" ? "mi" : "km";
  const kg = (v: number | null) => (v == null ? null : Math.round(toDisplay(v, "kg", units).value * 10) / 10);
  const m = (v: number | null) => (v == null ? null : Math.round(toDisplay(v, "m", units).value * 100) / 100);

  const payload: Record<string, unknown> = {
    date: dayKey(ctx.startMs, tz),
    type: ctx.isStrength ? "strength" : ctx.activityType,
    title: ctx.title,
    durationMinutes: ctx.durationS != null ? Math.round(ctx.durationS / 60) : null,
  };

  if (ctx.isStrength) {
    payload.exercises = ctx.exercises.map((e) => ({
      name: e.name,
      workingSets: e.workingSets,
      topSet: e.topSetWeightKg != null && e.topSetReps != null ? `${kg(e.topSetWeightKg)} ${mu} x ${e.topSetReps}` : null,
      estimated1RM: e.bestE1rmKg != null ? `${kg(e.bestE1rmKg)} ${mu}` : null,
      newPersonalBest: e.isNewPr,
    }));
    payload.totalVolume = `${kg(ctx.totalVolumeKg)} ${mu}`;
    payload.recentAverageVolume = ctx.avgRecentVolumeKg != null ? `${kg(ctx.avgRecentVolumeKg)} ${mu} (average of recent strength sessions)` : null;
  } else {
    payload.distance = ctx.distanceM != null ? `${m(ctx.distanceM)} ${du}` : null;
    payload.avgHeartRateBpm = ctx.avgHr != null ? Math.round(ctx.avgHr) : null;
    payload.pace = ctx.distanceM != null && ctx.durationS != null ? paceString(ctx.durationS / (ctx.distanceM / 1000), units, du) : null;
    payload.recentAveragePace = paceString(ctx.avgRecentPaceSecPerKm, units, du);
    payload.recentAverageDistance = ctx.avgRecentDistanceM != null ? `${m(ctx.avgRecentDistanceM)} ${du} (average of recent ${ctx.activityType} sessions)` : null;
  }

  return `Here is this workout's data, as JSON:\n${JSON.stringify(payload, null, 2)}`;
}

export async function generateWorkoutRating(
  db: DB,
  workoutId: number,
  units: UnitSystem,
  tz: string,
  apiKey: string,
  model: string,
): Promise<{ rating: WorkoutRatingLabel; summary: string; prompt: string; model: string }> {
  const ctx = buildWorkoutRatingContext(db, workoutId);
  if (!ctx) throw new Error("Workout not found.");
  const prompt = buildWorkoutRatingPrompt(ctx, units, tz);
  const res = await callGemini(prompt, WORKOUT_RATING_SYSTEM_INSTRUCTIONS, apiKey, model, { jsonMode: true, maxOutputTokens: 400 });
  const parsed = parseJsonResponse(res.text, workoutRatingResultSchema, "Workout rating");
  return { rating: parsed.rating, summary: parsed.summary, prompt, model };
}
