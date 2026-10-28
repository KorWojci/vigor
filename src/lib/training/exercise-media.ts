import path from "node:path";
import { config } from "../config";
import type { DB } from "../db";

/**
 * Matches Vigor's (Hevy-imported, free-text) exercise names against the ExerciseDB free API
 * catalog, and caches the matched demonstration GIF and muscle data locally. The actual HTTP
 * fetching lives in scripts/sync-exercise-media.ts, which runs offline/out of band — see the
 * invariant on external network calls in AGENTS.md. This module holds the pure matching logic and
 * the local cache's DB access, both usable without any network access.
 */

export const ATTRIBUTION = "Exercise media: AscendAPI / ExerciseDB free tier, non-commercial use.";

export interface ExerciseDbEntry {
  externalId: string;
  name: string;
  bodyParts: string[];
  targetMuscles: string[];
  secondaryMuscles: string[];
  equipments: string[];
  gifUrl: string;
}

/** Lowercases, strips punctuation, and crudely de-pluralises each word so "Pull Up" and "pull-ups" tokenize the same. */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 2 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/** Dice coefficient over word-token sets. Order-independent, so "Bench Press (Barbell)" matches "Barbell Bench Press". 1 = identical token sets. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return (2 * overlap) / (ta.size + tb.size);
}

/**
 * Below this, the "closest" candidate shares too few words to be trustworthy — treated as no
 * match (no image) rather than a guess. Calibrated against a real exercise list: every match at
 * or below 0.50 turned out wrong (e.g. "Bird Dog" → "upward facing dog", sharing only the
 * coincidental word "dog"), while 0.57 and up were all the same exercise under a different name.
 */
export const MATCH_THRESHOLD = 0.55;

export interface MatchResult {
  entry: ExerciseDbEntry;
  score: number;
}

/** Best catalog match for an exercise name, or null if nothing clears MATCH_THRESHOLD. */
export function findBestMatch(exerciseName: string, catalog: ExerciseDbEntry[]): MatchResult | null {
  let best: MatchResult | null = null;
  for (const entry of catalog) {
    const score = nameSimilarity(exerciseName, entry.name);
    if (!best || score > best.score) best = { entry, score };
  }
  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

export interface ExerciseMedia {
  exerciseId: number;
  externalId: string;
  matchedName: string;
  matchScore: number;
  bodyParts: string[];
  targetMuscles: string[];
  secondaryMuscles: string[];
  equipments: string[];
  gifFile: string;
  syncedAt: number;
}

interface Row {
  exerciseId: number;
  externalId: string;
  matchedName: string;
  matchScore: number;
  bodyParts: string;
  targetMuscles: string;
  secondaryMuscles: string;
  equipments: string;
  gifFile: string;
  syncedAt: number;
}

const COLUMNS = `exercise_id AS exerciseId, external_id AS externalId, matched_name AS matchedName, match_score AS matchScore,
  body_parts AS bodyParts, target_muscles AS targetMuscles, secondary_muscles AS secondaryMuscles, equipments AS equipments,
  gif_file AS gifFile, synced_at AS syncedAt`;

function fromRow(r: Row): ExerciseMedia {
  return {
    ...r,
    bodyParts: JSON.parse(r.bodyParts),
    targetMuscles: JSON.parse(r.targetMuscles),
    secondaryMuscles: JSON.parse(r.secondaryMuscles),
    equipments: JSON.parse(r.equipments),
  };
}

export function getExerciseMedia(db: DB, exerciseId: number): ExerciseMedia | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM exercise_media WHERE exercise_id = ?`).get(exerciseId) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Media for several exercises at once (e.g. every exercise in a workout), keyed by exercise id. */
export function listExerciseMedia(db: DB, exerciseIds: number[]): Map<number, ExerciseMedia> {
  if (exerciseIds.length === 0) return new Map();
  const placeholders = exerciseIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT ${COLUMNS} FROM exercise_media WHERE exercise_id IN (${placeholders})`).all(...exerciseIds) as Row[];
  return new Map(rows.map((r) => [r.exerciseId, fromRow(r)]));
}

export function upsertExerciseMedia(db: DB, media: Omit<ExerciseMedia, "syncedAt"> & { syncedAt?: number }): void {
  db.prepare(
    `INSERT INTO exercise_media (exercise_id, external_id, matched_name, match_score, body_parts, target_muscles, secondary_muscles, equipments, gif_file, synced_at)
     VALUES (@exerciseId, @externalId, @matchedName, @matchScore, @bodyParts, @targetMuscles, @secondaryMuscles, @equipments, @gifFile, @syncedAt)
     ON CONFLICT(exercise_id) DO UPDATE SET external_id = excluded.external_id, matched_name = excluded.matched_name,
       match_score = excluded.match_score, body_parts = excluded.body_parts, target_muscles = excluded.target_muscles,
       secondary_muscles = excluded.secondary_muscles, equipments = excluded.equipments, gif_file = excluded.gif_file,
       synced_at = excluded.synced_at`,
  ).run({
    ...media,
    bodyParts: JSON.stringify(media.bodyParts),
    targetMuscles: JSON.stringify(media.targetMuscles),
    secondaryMuscles: JSON.stringify(media.secondaryMuscles),
    equipments: JSON.stringify(media.equipments),
    syncedAt: media.syncedAt ?? Date.now(),
  });
}

export function deleteExerciseMedia(db: DB, exerciseId: number): void {
  db.prepare("DELETE FROM exercise_media WHERE exercise_id = ?").run(exerciseId);
}

const MEDIA_DIR_NAME = "exercise-media";
const GIF_FILE_RE = /^[A-Za-z0-9_-]+\.gif$/;

export function exerciseMediaDir(): string {
  return path.join(config.dataDir, MEDIA_DIR_NAME);
}

/** Resolves a cached gif_file to a path on disk, or null if the stored name isn't a plain "<id>.gif" (defends the media route against path traversal). */
export function exerciseMediaFilePath(gifFile: string): string | null {
  if (!GIF_FILE_RE.test(gifFile)) return null;
  return path.join(exerciseMediaDir(), gifFile);
}
