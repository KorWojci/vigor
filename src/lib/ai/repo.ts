import type { DB } from "../db";

export type RecapScope = "full" | "training";

export interface WeeklyRecap {
  weekStart: string;
  scope: RecapScope;
  generatedAt: number;
  model: string;
  content: string;
  prompt: string;
}

export function getWeeklyRecap(db: DB, weekStart: string, scope: RecapScope): WeeklyRecap | null {
  const row = db
    .prepare("SELECT week_start AS weekStart, scope, generated_at AS generatedAt, model, content, prompt FROM weekly_recaps WHERE week_start = ? AND scope = ?")
    .get(weekStart, scope) as WeeklyRecap | undefined;
  return row ?? null;
}

export function saveWeeklyRecap(db: DB, recap: WeeklyRecap): void {
  db.prepare(
    `INSERT INTO weekly_recaps (week_start, scope, generated_at, model, content, prompt) VALUES (@weekStart, @scope, @generatedAt, @model, @content, @prompt)
     ON CONFLICT(week_start, scope) DO UPDATE SET generated_at = excluded.generated_at, model = excluded.model, content = excluded.content, prompt = excluded.prompt`,
  ).run(recap);
}

export interface WorkoutRating {
  workoutId: number;
  generatedAt: number;
  model: string;
  rating: string;
  summary: string;
  prompt: string;
}

export function getWorkoutRating(db: DB, workoutId: number): WorkoutRating | null {
  const row = db
    .prepare("SELECT workout_id AS workoutId, generated_at AS generatedAt, model, rating, summary, prompt FROM workout_ratings WHERE workout_id = ?")
    .get(workoutId) as WorkoutRating | undefined;
  return row ?? null;
}

export function saveWorkoutRating(db: DB, rating: WorkoutRating): void {
  db.prepare(
    `INSERT INTO workout_ratings (workout_id, generated_at, model, rating, summary, prompt) VALUES (@workoutId, @generatedAt, @model, @rating, @summary, @prompt)
     ON CONFLICT(workout_id) DO UPDATE SET generated_at = excluded.generated_at, model = excluded.model, rating = excluded.rating, summary = excluded.summary, prompt = excluded.prompt`,
  ).run(rating);
}

export interface SleepSummary {
  night: string;
  generatedAt: number;
  model: string;
  summary: string;
  prompt: string;
}

export function getSleepSummary(db: DB, night: string): SleepSummary | null {
  const row = db
    .prepare("SELECT night, generated_at AS generatedAt, model, summary, prompt FROM sleep_summaries WHERE night = ?")
    .get(night) as SleepSummary | undefined;
  return row ?? null;
}

export function saveSleepSummary(db: DB, summary: SleepSummary): void {
  db.prepare(
    `INSERT INTO sleep_summaries (night, generated_at, model, summary, prompt) VALUES (@night, @generatedAt, @model, @summary, @prompt)
     ON CONFLICT(night) DO UPDATE SET generated_at = excluded.generated_at, model = excluded.model, summary = excluded.summary, prompt = excluded.prompt`,
  ).run(summary);
}
