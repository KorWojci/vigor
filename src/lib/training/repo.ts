import type { DB } from "../db";
import { normalizeExerciseName, sessionStats, type ExerciseKind, type SessionStats, type SetData } from "./calculations";
import { refreshExerciseKinds } from "./hevy-import";
import { decodeRoute, type RoutePoint } from "./route";
import { decodeWeather, type Weather } from "./weather";

export interface WorkoutListItem {
  id: number;
  source: string;
  title: string | null;
  activityType: string | null;
  startMs: number;
  endMs: number | null;
  durationS: number | null;
  energyKcal: number | null;
  distanceM: number | null;
  avgHr: number | null;
  sourceName: string | null;
  exerciseCount: number;
  setCount: number;
  volumeKg: number;
  /** Apple Health workout recorded at the same time as this Hevy workout. */
  linked?: { id: number; energyKcal: number | null; avgHr: number | null; sourceName: string | null } | null;
}

/**
 * Lists workouts in a time window. Hevy usually also writes its workouts to Apple Health, so an
 * Apple Health workout overlapping a Hevy workout is shown as linked metadata (energy, heart rate)
 * of the Hevy workout instead of as a second workout.
 */
export function listWorkouts(db: DB, startMs: number, endMs: number): WorkoutListItem[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.source, w.title, w.activity_type AS activityType, w.start_ms AS startMs, w.end_ms AS endMs,
         w.duration_s AS durationS, w.energy_kcal AS energyKcal, w.distance_m AS distanceM, w.avg_hr AS avgHr,
         w.source_name AS sourceName,
         (SELECT COUNT(*) FROM workout_exercises we WHERE we.workout_id = w.id) AS exerciseCount,
         (SELECT COUNT(*) FROM exercise_sets es JOIN workout_exercises we ON we.id = es.workout_exercise_id
            WHERE we.workout_id = w.id AND es.set_type != 'warmup') AS setCount,
         (SELECT COALESCE(SUM(es.weight_kg * es.reps), 0) FROM exercise_sets es
            JOIN workout_exercises we ON we.id = es.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id
            WHERE we.workout_id = w.id AND es.set_type != 'warmup' AND e.kind IN ('weighted','weighted_bodyweight')) AS volumeKg
       FROM workouts w WHERE w.deleted_at IS NULL AND w.start_ms >= ? AND w.start_ms < ? ORDER BY w.start_ms DESC`,
    )
    .all(startMs, endMs) as WorkoutListItem[];
  const hevy = rows.filter((r) => r.source === "hevy");
  const others = rows.filter((r) => r.source !== "hevy");
  const consumed = new Set<number>();
  for (const h of hevy) {
    const hEnd = h.endMs ?? h.startMs + (h.durationS ?? 3600) * 1000;
    const match = others.find((o) => {
      if (consumed.has(o.id)) return false;
      const oEnd = o.endMs ?? o.startMs;
      const overlap = Math.min(hEnd, oEnd) - Math.max(h.startMs, o.startMs);
      return overlap > 0.5 * Math.min(hEnd - h.startMs, oEnd - o.startMs);
    });
    if (match) {
      consumed.add(match.id);
      h.linked = { id: match.id, energyKcal: match.energyKcal, avgHr: match.avgHr, sourceName: match.sourceName };
    }
  }
  return rows.filter((r) => !consumed.has(r.id));
}

export interface WorkoutDetail extends WorkoutListItem {
  notes: string | null;
  maxHr: number | null;
  route: RoutePoint[] | null;
  weather: Weather | null;
  exercises: { id: number; exerciseId: number; name: string; kind: ExerciseKind; notes: string | null; sets: (SetData & { id: number; setIndex: number })[]; stats: SessionStats }[];
}

export function getWorkout(db: DB, id: number): WorkoutDetail | null {
  const w = db
    .prepare(
      `SELECT id, source, title, activity_type AS activityType, start_ms AS startMs, end_ms AS endMs, duration_s AS durationS,
       energy_kcal AS energyKcal, distance_m AS distanceM, avg_hr AS avgHr, max_hr AS maxHr, source_name AS sourceName, notes,
       route AS routeRaw, weather AS weatherRaw
       FROM workouts WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as (WorkoutListItem & { notes: string | null; maxHr: number | null; routeRaw: string | null; weatherRaw: string | null }) | undefined;
  if (!w) return null;
  const { routeRaw, weatherRaw, ...w2 } = w;
  const route = decodeRoute(routeRaw);
  const weather = decodeWeather(weatherRaw);
  const exercises = db
    .prepare(
      `SELECT we.id, we.exercise_id AS exerciseId, e.name, e.kind, we.notes FROM workout_exercises we
       JOIN exercises e ON e.id = we.exercise_id WHERE we.workout_id = ? ORDER BY we.position`,
    )
    .all(id) as { id: number; exerciseId: number; name: string; kind: ExerciseKind; notes: string | null }[];
  const getSets = db.prepare(
    `SELECT id, set_index AS setIndex, set_type AS setType, weight_kg AS weightKg, reps, distance_m AS distanceM,
     duration_s AS durationS, rpe FROM exercise_sets WHERE workout_exercise_id = ? ORDER BY set_index, id`,
  );
  const full = exercises.map((e) => {
    const sets = getSets.all(e.id) as (SetData & { id: number; setIndex: number })[];
    return { ...e, sets, stats: sessionStats(e.kind, sets) };
  });
  return {
    ...w2,
    route,
    weather,
    exerciseCount: full.length,
    setCount: full.reduce((a, e) => a + e.stats.workingSets, 0),
    volumeKg: full.reduce((a, e) => a + e.stats.volumeKg, 0),
    exercises: full,
  };
}

export interface ExerciseListItem {
  id: number;
  name: string;
  kind: ExerciseKind;
  kindLocked: boolean;
  sessions: number;
  lastMs: number | null;
  firstMs: number | null;
  aliases: string[];
}

export function listExercises(db: DB): ExerciseListItem[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.kind, e.kind_locked AS kindLocked,
         COUNT(DISTINCT w.id) AS sessions, MAX(w.start_ms) AS lastMs, MIN(w.start_ms) AS firstMs
       FROM exercises e
       LEFT JOIN workout_exercises we ON we.exercise_id = e.id
       LEFT JOIN workouts w ON w.id = we.workout_id AND w.deleted_at IS NULL
       GROUP BY e.id ORDER BY lastMs IS NULL, lastMs DESC, e.name`,
    )
    .all() as (Omit<ExerciseListItem, "kindLocked" | "aliases"> & { kindLocked: number })[];
  const aliases = db.prepare("SELECT exercise_id AS id, alias FROM exercise_aliases").all() as { id: number; alias: string }[];
  return rows.map((r) => ({ ...r, kindLocked: r.kindLocked === 1, aliases: aliases.filter((a) => a.id === r.id).map((a) => a.alias) }));
}

export interface ExerciseSession {
  workoutId: number;
  workoutTitle: string | null;
  startMs: number;
  sets: (SetData & { setIndex: number })[];
  stats: SessionStats;
}

export interface PersonalRecord {
  label: string;
  value: number;
  unit: "kg" | "reps" | "s" | "m";
  startMs: number;
  workoutId: number;
  detail?: string;
}

export interface ExerciseHistory {
  exercise: ExerciseListItem;
  sessions: ExerciseSession[]; // oldest first
  records: PersonalRecord[];
}

export function getExerciseHistory(db: DB, exerciseId: number): ExerciseHistory | null {
  const exercise = listExercises(db).find((e) => e.id === exerciseId);
  if (!exercise) return null;
  const rows = db
    .prepare(
      `SELECT w.id AS workoutId, w.title AS workoutTitle, w.start_ms AS startMs, we.id AS weId,
         es.set_index AS setIndex, es.set_type AS setType, es.weight_kg AS weightKg, es.reps, es.distance_m AS distanceM,
         es.duration_s AS durationS, es.rpe
       FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id AND w.deleted_at IS NULL
       JOIN exercise_sets es ON es.workout_exercise_id = we.id
       WHERE we.exercise_id = ? ORDER BY w.start_ms, we.position, es.set_index, es.id`,
    )
    .all(exerciseId) as (SetData & { workoutId: number; workoutTitle: string | null; startMs: number; weId: number; setIndex: number })[];
  const byWorkout = new Map<number, ExerciseSession>();
  for (const r of rows) {
    let s = byWorkout.get(r.workoutId);
    if (!s) {
      s = { workoutId: r.workoutId, workoutTitle: r.workoutTitle, startMs: r.startMs, sets: [], stats: null as unknown as SessionStats };
      byWorkout.set(r.workoutId, s);
    }
    s.sets.push({ setIndex: r.setIndex, setType: r.setType, weightKg: r.weightKg, reps: r.reps, distanceM: r.distanceM, durationS: r.durationS, rpe: r.rpe });
  }
  const sessions = [...byWorkout.values()].map((s) => ({ ...s, stats: sessionStats(exercise.kind, s.sets) }));
  return { exercise, sessions, records: personalRecords(exercise.kind, sessions) };
}

export function personalRecords(kind: ExerciseKind, sessions: ExerciseSession[]): PersonalRecord[] {
  const best = (label: string, unit: PersonalRecord["unit"], pick: (s: ExerciseSession) => number | null, lowerIsBetter = false, detail?: (s: ExerciseSession) => string) => {
    let rec: PersonalRecord | null = null;
    for (const s of sessions) {
      const v = pick(s);
      if (v === null || v <= 0) continue;
      if (!rec || (lowerIsBetter ? v < rec.value : v > rec.value)) rec = { label, value: v, unit, startMs: s.startMs, workoutId: s.workoutId, detail: detail?.(s) };
    }
    return rec;
  };
  const topSetText = (s: ExerciseSession) =>
    s.stats.topSet ? `${s.stats.topSet.weightKg ?? 0} kg × ${s.stats.topSet.reps ?? 0}` : "";
  const out: (PersonalRecord | null)[] = [];
  switch (kind) {
    case "weighted":
    case "weighted_bodyweight":
      out.push(best("Estimated 1RM", "kg", (s) => s.stats.bestE1RM, false, topSetText));
      out.push(best("Heaviest weight", "kg", (s) => s.stats.maxWeightKg));
      out.push(best("Session volume", "kg", (s) => s.stats.volumeKg));
      out.push(best("Most reps in a set", "reps", (s) => Math.max(0, ...s.sets.filter((x) => x.setType !== "warmup").map((x) => x.reps ?? 0))));
      break;
    case "bodyweight":
      out.push(best("Most reps in a set", "reps", (s) => Math.max(0, ...s.sets.filter((x) => x.setType !== "warmup").map((x) => x.reps ?? 0))));
      out.push(best("Most reps in a session", "reps", (s) => s.stats.totalReps));
      break;
    case "assisted":
      out.push(best("Least assistance", "kg", (s) => s.stats.minAssistanceKg, true));
      out.push(best("Most reps in a session", "reps", (s) => s.stats.totalReps));
      break;
    case "duration":
      out.push(best("Longest set", "s", (s) => Math.max(0, ...s.sets.map((x) => x.durationS ?? 0))));
      out.push(best("Total time in a session", "s", (s) => s.stats.totalDurationS));
      break;
    case "distance":
      out.push(best("Longest set", "m", (s) => Math.max(0, ...s.sets.map((x) => x.distanceM ?? 0))));
      out.push(best("Total distance in a session", "m", (s) => s.stats.totalDistanceM));
      break;
  }
  return out.filter((r): r is PersonalRecord => r !== null);
}

export function setExerciseKind(db: DB, exerciseId: number, kind: ExerciseKind | "auto"): void {
  if (kind === "auto") {
    db.prepare("UPDATE exercises SET kind_locked = 0 WHERE id = ?").run(exerciseId);
    refreshExerciseKinds(db, [exerciseId]);
  } else {
    db.prepare("UPDATE exercises SET kind = ?, kind_locked = 1 WHERE id = ?").run(kind, exerciseId);
  }
}

/**
 * Merges `sourceId` into `targetId` (exercise-matching adjustment). All history moves to the
 * target and the source name becomes an alias, so future imports map to the target too.
 */
export function mergeExercises(db: DB, sourceId: number, targetId: number): void {
  if (sourceId === targetId) throw new Error("Choose two different exercises.");
  db.transaction(() => {
    const src = db.prepare("SELECT name FROM exercises WHERE id = ?").get(sourceId) as { name: string } | undefined;
    const dst = db.prepare("SELECT id FROM exercises WHERE id = ?").get(targetId);
    if (!src || !dst) throw new Error("Exercise not found.");
    db.prepare("UPDATE workout_exercises SET exercise_id = ? WHERE exercise_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE exercise_aliases SET exercise_id = ? WHERE exercise_id = ?").run(targetId, sourceId);
    db.prepare(
      "INSERT INTO exercise_aliases (alias_normalized, alias, exercise_id) VALUES (?, ?, ?) ON CONFLICT(alias_normalized) DO UPDATE SET exercise_id = excluded.exercise_id",
    ).run(normalizeExerciseName(src.name), src.name, targetId);
    db.prepare("DELETE FROM exercises WHERE id = ?").run(sourceId);
    refreshExerciseKinds(db, [targetId]);
  })();
}

/** Workouts per ISO week (Monday start) for the consistency chart. */
export function workoutsPerWeek(items: { startMs: number }[], weekKey: (ms: number) => string): { week: string; count: number }[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(weekKey(i.startMs), (m.get(weekKey(i.startMs)) ?? 0) + 1);
  return [...m.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week));
}
