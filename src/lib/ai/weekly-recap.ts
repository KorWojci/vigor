import { z } from "zod";
import type { DB } from "../db";
import { getDailySeries, getMetricSummary, getSleepNights } from "../aggregation/series";
import { callGemini, parseJsonResponse } from "./gemini";
import { getWorkout, listWorkouts } from "../training/repo";
import { addDays, dayKey, formatDateTime, makeRange, previousRange } from "../time";
import { formatDuration, toDisplay, type UnitSystem } from "../units";

/**
 * The weekly AI recap — see CLAUDE.md invariant 9: the one sanctioned exception to "no external
 * network calls", and only ever run when the user explicitly clicks Generate/Regenerate
 * (src/app/ai-actions.ts). Gathers a week of the user's own training/sleep/nutrition/weight data
 * (buildWeeklyRecapInput), formats it into a prompt (buildPrompt), and sends it to Gemini
 * (src/lib/ai/gemini.ts) asking for structured JSON back (WeeklyRecapResult).
 */

export interface StrengthExerciseSummary {
  name: string;
  workingSets: number;
  topSetWeightKg: number | null;
  topSetReps: number | null;
  bestE1rmKg: number | null;
}

export interface StrengthSessionSummary {
  day: string;
  title: string | null;
  exercises: StrengthExerciseSummary[];
}

export interface CardioSessionSummary {
  day: string;
  activityType: string | null;
  distanceM: number | null;
  durationS: number | null;
  avgHr: number | null;
}

export interface NightSummary {
  date: string;
  asleepMinutes: number;
  deepMinutes: number | null;
  remMinutes: number | null;
  coreMinutes: number | null;
  bedtimeMs: number;
  wakeMs: number;
}

export interface WeeklyRecapInput {
  weekStart: string;
  weekEnd: string;
  training: {
    workoutCount: number;
    totalDurationS: number;
    strength: StrengthSessionSummary[];
    cardio: CardioSessionSummary[];
  };
  sleep: {
    nights: NightSummary[];
    avgAsleepMinutes: number | null;
  };
  nutrition: {
    daysLogged: number;
    avgKcal: number | null;
    avgProteinG: number | null;
    avgCarbsG: number | null;
    avgFatG: number | null;
  };
  /** End-of-week minus start-of-week logged weight, canonical kg — null if under two readings. */
  weightChangeKg: number | null;
}

/** Gathers one ISO week (Monday `weekStartDay`) of this user's own data. Canonical units — buildPrompt converts for display. */
export function buildWeeklyRecapInput(db: DB, weekStartDay: string, tz: string): WeeklyRecapInput {
  const weekEndDay = addDays(weekStartDay, 6);
  const range = makeRange(weekStartDay, weekEndDay, tz);

  const workouts = listWorkouts(db, range.startMs, range.endMs);
  const strength: StrengthSessionSummary[] = [];
  const cardio: CardioSessionSummary[] = [];
  let totalDurationS = 0;
  for (const w of workouts) {
    totalDurationS += w.durationS ?? 0;
    if (w.exerciseCount > 0) {
      const full = getWorkout(db, w.id);
      if (!full) continue;
      strength.push({
        day: dayKey(w.startMs, tz),
        title: full.title,
        exercises: full.exercises.map((e) => ({
          name: e.name,
          workingSets: e.stats.workingSets,
          topSetWeightKg: e.stats.topSet?.weightKg ?? null,
          topSetReps: e.stats.topSet?.reps ?? null,
          bestE1rmKg: e.stats.bestE1RM,
        })),
      });
    } else {
      cardio.push({
        day: dayKey(w.startMs, tz),
        activityType: w.activityType,
        distanceM: w.distanceM,
        durationS: w.durationS,
        avgHr: w.avgHr ?? w.linked?.avgHr ?? null,
      });
    }
  }

  const nights = getSleepNights(db, range, tz);
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

  const previous = previousRange(range, tz);
  const dietary = getMetricSummary(db, "dietary_energy", range, previous, tz);
  const protein = getMetricSummary(db, "dietary_protein", range, previous, tz);
  const carbs = getMetricSummary(db, "dietary_carbohydrates", range, previous, tz);
  const fat = getMetricSummary(db, "dietary_fat", range, previous, tz);

  const weightSeries = getDailySeries(db, "body_mass", range, tz);
  const weightChangeKg = weightSeries.length >= 2 ? weightSeries[weightSeries.length - 1].value - weightSeries[0].value : null;

  return {
    weekStart: weekStartDay,
    weekEnd: weekEndDay,
    training: { workoutCount: workouts.length, totalDurationS, strength, cardio },
    sleep: {
      nights: nights.map((n) => ({
        date: n.day,
        asleepMinutes: n.asleepMin,
        deepMinutes: n.hasStages ? n.stages.deep : null,
        remMinutes: n.hasStages ? n.stages.rem : null,
        coreMinutes: n.hasStages ? n.stages.core : null,
        bedtimeMs: n.startMs,
        wakeMs: n.endMs,
      })),
      avgAsleepMinutes: avg(nights.map((n) => n.asleepMin)),
    },
    nutrition: {
      daysLogged: dietary?.daysWithData ?? 0,
      avgKcal: dietary?.value ?? null,
      avgProteinG: protein?.value ?? null,
      avgCarbsG: carbs?.value ?? null,
      avgFatG: fat?.value ?? null,
    },
    weightChangeKg,
  };
}

export const RECAP_SYSTEM_INSTRUCTIONS = `You are a concise, factual fitness and health assistant inside a personal health-tracking app called Vigor. You will be given one week of a single user's own logged training, sleep and nutrition data as JSON. Respond with ONLY a single JSON object (no markdown fences, no extra text) matching exactly this shape:

{
  "summary": string,       // 2-4 sentences, plain prose, overview of the week
  "goodThings": string[],  // short points on what went well this week — an empty array if there is genuinely nothing to point to
  "badThings": string[],   // short points on concerns, inconsistencies or gaps this week — an empty array if none
  "suggestion": string,    // 1-3 sentences: one concrete, actionable thing to try next week, grounded in the above
  "sleepByNight": [{ "date": string, "note": string }]  // one short sentence per night that has data, in date order; omit nights with no data entirely
}

Rules:
- Only state facts present in the JSON you are given. Never invent a number, date, exercise name or event that isn't there.
- If a whole category (training, sleep or nutrition) has no data at all, say so plainly in "summary" and leave the related arrays empty — never guess.
- Describe training specifically in "summary", "goodThings" and "badThings": name the actual exercises and sessions, not just "you trained 3 times".
- "badThings" and "suggestion" should read as constructive, not critical — this is the user's own data, not a judgement of them as a person.
- Do not give medical advice or diagnose anything. A simple observation tying two logged facts together (e.g. a short night before a hard session) is fine; speculating about causes you have no data for is not.
- Output must be valid JSON and nothing else.`;

export const weeklyRecapResultSchema = z.object({
  summary: z.string().min(1),
  goodThings: z.array(z.string().min(1)),
  badThings: z.array(z.string().min(1)),
  suggestion: z.string().min(1),
  sleepByNight: z.array(z.object({ date: z.string().min(1), note: z.string().min(1) })),
});
export type WeeklyRecapResult = z.infer<typeof weeklyRecapResultSchema>;

function trainingSection(training: WeeklyRecapInput["training"], units: UnitSystem) {
  const mu = units === "imperial" ? "lb" : "kg";
  const du = units === "imperial" ? "mi" : "km";
  const kg = (v: number | null) => (v == null ? null : Math.round(toDisplay(v, "kg", units).value * 10) / 10);
  const m = (v: number | null) => (v == null ? null : Math.round(toDisplay(v, "m", units).value * 100) / 100);
  const round = (v: number | null) => (v == null ? null : Math.round(v));
  return {
    totalWorkouts: training.workoutCount,
    totalTrainingTime: training.totalDurationS > 0 ? formatDuration(training.totalDurationS / 60) : null,
    strengthSessions: training.strength.map((s) => ({
      date: s.day,
      title: s.title,
      exercises: s.exercises.map((e) => ({
        name: e.name,
        workingSets: e.workingSets,
        topSet: e.topSetWeightKg != null && e.topSetReps != null ? `${kg(e.topSetWeightKg)} ${mu} x ${e.topSetReps}` : null,
        estimated1RM: e.bestE1rmKg != null ? `${kg(e.bestE1rmKg)} ${mu}` : null,
      })),
    })),
    cardioSessions: training.cardio.map((c) => ({
      date: c.day,
      activityType: c.activityType,
      distance: c.distanceM != null ? `${m(c.distanceM)} ${du}` : null,
      duration: c.durationS != null ? formatDuration(c.durationS / 60) : null,
      avgHeartRateBpm: round(c.avgHr),
    })),
  };
}

/** The per-week data prompt (not the system instructions, which are static — see RECAP_SYSTEM_INSTRUCTIONS). Pure and testable: no network, no DB. */
export function buildPrompt(input: WeeklyRecapInput, units: UnitSystem, tz: string): string {
  const mu = units === "imperial" ? "lb" : "kg";
  const kg = (v: number | null) => (v == null ? null : Math.round(toDisplay(v, "kg", units).value * 10) / 10);
  const round = (v: number | null) => (v == null ? null : Math.round(v));
  const clock = (ms: number) => formatDateTime(ms, tz).split(", ")[1];
  const weightChange = kg(input.weightChangeKg);

  const payload = {
    weekOf: `${input.weekStart} to ${input.weekEnd}`,
    training: trainingSection(input.training, units),
    sleep: {
      nights: input.sleep.nights.map((n) => ({
        date: n.date,
        asleep: formatDuration(n.asleepMinutes),
        bedtime: clock(n.bedtimeMs),
        wake: clock(n.wakeMs),
        deep: n.deepMinutes != null ? formatDuration(n.deepMinutes) : null,
        rem: n.remMinutes != null ? formatDuration(n.remMinutes) : null,
        core: n.coreMinutes != null ? formatDuration(n.coreMinutes) : null,
      })),
      avgAsleep: input.sleep.avgAsleepMinutes != null ? formatDuration(input.sleep.avgAsleepMinutes) : null,
    },
    nutrition: {
      daysLogged: `${input.nutrition.daysLogged} of 7`,
      avgDailyKcal: round(input.nutrition.avgKcal),
      avgProtein: input.nutrition.avgProteinG != null ? `${round(input.nutrition.avgProteinG)} g` : null,
      avgCarbs: input.nutrition.avgCarbsG != null ? `${round(input.nutrition.avgCarbsG)} g` : null,
      avgFat: input.nutrition.avgFatG != null ? `${round(input.nutrition.avgFatG)} g` : null,
    },
    weightChange: weightChange != null ? `${weightChange > 0 ? "+" : ""}${weightChange} ${mu}` : null,
  };

  return `Here is this week's data, as JSON:\n${JSON.stringify(payload, null, 2)}`;
}

export const TRAINING_RECAP_SYSTEM_INSTRUCTIONS = `You are a concise, factual training assistant inside a personal health-tracking app called Vigor. You will be given one week of a single user's own logged training data as JSON (no sleep or nutrition — this recap is training only). Respond with ONLY a single JSON object (no markdown fences, no extra text) matching exactly this shape:

{
  "summary": string,       // 2-4 sentences, plain prose, overview of the week's training
  "goodThings": string[],  // short points on what went well — an empty array if there is genuinely nothing to point to
  "badThings": string[],   // short points on concerns, inconsistencies or gaps — an empty array if none
  "suggestion": string     // 1-3 sentences: one concrete, actionable thing to try next week, grounded in the above
}

Rules:
- Only state facts present in the JSON you are given. Never invent a number, date, exercise name or event that isn't there.
- If there is no training data at all, say so plainly in "summary" and leave the arrays empty — never guess.
- Name actual exercises and sessions specifically, not just "you trained 3 times".
- "badThings" and "suggestion" should read as constructive, not critical — this is the user's own data, not a judgement of them as a person.
- Do not give medical advice or diagnose anything.
- Output must be valid JSON and nothing else.`;

export const weeklyTrainingRecapResultSchema = z.object({
  summary: z.string().min(1),
  goodThings: z.array(z.string().min(1)),
  badThings: z.array(z.string().min(1)),
  suggestion: z.string().min(1),
});
export type WeeklyTrainingRecapResult = z.infer<typeof weeklyTrainingRecapResultSchema>;

/** Training facts only — no sleep or nutrition data is even sent, so the model can't sneak commentary about them in. */
export function buildTrainingPrompt(training: WeeklyRecapInput["training"], weekStart: string, weekEnd: string, units: UnitSystem): string {
  const payload = { weekOf: `${weekStart} to ${weekEnd}`, training: trainingSection(training, units) };
  return `Here is this week's training data, as JSON:\n${JSON.stringify(payload, null, 2)}`;
}

export async function generateWeeklyRecap(
  db: DB,
  weekStartDay: string,
  tz: string,
  units: UnitSystem,
  apiKey: string,
  model: string,
): Promise<{ result: WeeklyRecapResult; prompt: string; model: string }> {
  const input = buildWeeklyRecapInput(db, weekStartDay, tz);
  const prompt = buildPrompt(input, units, tz);
  const res = await callGemini(prompt, RECAP_SYSTEM_INSTRUCTIONS, apiKey, model, { jsonMode: true, maxOutputTokens: 900 });
  const result = parseJsonResponse(res.text, weeklyRecapResultSchema, "Weekly recap");
  return { result, prompt, model };
}

export async function generateWeeklyTrainingRecap(
  db: DB,
  weekStartDay: string,
  tz: string,
  units: UnitSystem,
  apiKey: string,
  model: string,
): Promise<{ result: WeeklyTrainingRecapResult; prompt: string; model: string }> {
  const input = buildWeeklyRecapInput(db, weekStartDay, tz);
  const prompt = buildTrainingPrompt(input.training, input.weekStart, input.weekEnd, units);
  const res = await callGemini(prompt, TRAINING_RECAP_SYSTEM_INSTRUCTIONS, apiKey, model, { jsonMode: true, maxOutputTokens: 700 });
  const result = parseJsonResponse(res.text, weeklyTrainingRecapResultSchema, "Weekly training recap");
  return { result, prompt, model };
}
