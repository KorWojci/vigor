import crypto from "node:crypto";
import type { DB } from "../db";
import { zonedWallTimeToUtc } from "../time";
import { csvToObjects } from "./csv";
import { inferKind, normalizeExerciseName, type SetData } from "./calculations";

/**
 * Imports the workout CSV produced by Hevy (Profile → Settings → Export & Import Data → Export Workouts).
 * See docs/hevy-import.md for the column contract.
 *
 * - Workouts are identified by title + start time, so importing the same (or a newer, larger)
 *   export again never duplicates workouts; changed workouts are replaced.
 * - Hevy writes local wall-clock times without a zone; they are interpreted in the configured
 *   time zone.
 * - Exercise names are matched via aliases (Settings → Training imports) so renamed or
 *   duplicate exercises can be merged.
 */
export const HEVY_SOURCE = "hevy";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Parses Hevy timestamps: "20 Oct 2026, 07:05", "Oct 20, 2026 7:05 AM", "Oct 20, 2026 at 7:05 AM", "2026-10-20 07:05:00" or ISO with offset. */
export function parseHevyTime(raw: string, tz: string): number | null {
  // Newer exports write "Oct 22, 2026 at 6:43 AM", sometimes with a narrow no-break space before AM/PM.
  const s = raw.replace(/[\u00a0\u202f]/g, " ").trim().replace(/\s+at\s+/i, " ");
  if (!s) return null;
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  let m = /^(\d{1,2}) ([A-Za-z]{3,4})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    return zonedWallTimeToUtc(+m[3], month, +m[1], to24(+m[4], m[7]), +m[5], +(m[6] ?? 0), tz);
  }
  m = /^([A-Za-z]{3,4})[a-z]* (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    return zonedWallTimeToUtc(+m[3], month, +m[2], to24(+m[4], m[7]), +m[5], +(m[6] ?? 0), tz);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return zonedWallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), tz);
  return null;
}

function to24(h: number, ampm?: string): number {
  if (!ampm) return h;
  const pm = ampm.toLowerCase() === "pm";
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface HevyImportSummary {
  importRunId: number;
  workouts: number;
  accepted: number;
  updated: number;
  skipped: number;
  rejected: number;
  deleted: number;
  /** "Remove missing" was requested but not applied because some rows could not be read. */
  removeSkipped: boolean;
  exercisesCreated: number;
  rowErrors: { row: number; reason: string }[];
}

export class HevyFormatError extends Error {}

interface ParsedWorkout {
  key: string;
  title: string;
  startRaw: string;
  startMs: number;
  endMs: number | null;
  description: string;
  exercises: { title: string; supersetId: string | null; notes: string; sets: (SetData & { index: number })[] }[];
}

export function parseHevyCsv(text: string, tz: string): { workouts: ParsedWorkout[]; rowErrors: { row: number; reason: string }[] } {
  const { header, records } = csvToObjects(text);
  const required = ["title", "start_time", "exercise_title"];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) throw new HevyFormatError(`Not a Hevy workout export: missing column(s) ${missing.join(", ")}.`);
  const imperial = header.includes("weight_lbs") && !header.includes("weight_kg");

  const workouts = new Map<string, ParsedWorkout>();
  const rowErrors: { row: number; reason: string }[] = [];
  records.forEach((r, i) => {
    const rowNo = i + 2;
    const startMs = parseHevyTime(r.start_time, tz);
    if (startMs === null) return rowErrors.push({ row: rowNo, reason: `unrecognised start_time '${r.start_time}'` });
    if (!r.exercise_title) return rowErrors.push({ row: rowNo, reason: "missing exercise_title" });
    const key = `${r.title}|${r.start_time}`;
    let w = workouts.get(key);
    if (!w) {
      w = { key, title: r.title || "Workout", startRaw: r.start_time, startMs, endMs: parseHevyTime(r.end_time ?? "", tz), description: r.description ?? "", exercises: [] };
      workouts.set(key, w);
    }
    const weight = imperial ? num(r.weight_lbs) : num(r.weight_kg);
    const distance = header.includes("distance_miles") && !header.includes("distance_km") ? num(r.distance_miles) : num(r.distance_km);
    const set = {
      index: num(r.set_index) ?? 0,
      setType: (r.set_type || "normal").toLowerCase(),
      weightKg: weight === null ? null : imperial ? weight * 0.45359237 : weight,
      reps: num(r.reps) === null ? null : Math.round(num(r.reps)!),
      distanceM: distance === null ? null : distance * (header.includes("distance_miles") && !header.includes("distance_km") ? 1609.344 : 1000),
      durationS: num(r.duration_seconds),
      rpe: num(r.rpe),
    };
    const last = w.exercises[w.exercises.length - 1];
    const supersetId = r.superset_id || null;
    if (last && last.title === r.exercise_title && last.supersetId === supersetId && !(set.index === 0 && last.sets.length > 0 && last.sets.some((s) => s.index === 0))) {
      last.sets.push(set);
    } else {
      w.exercises.push({ title: r.exercise_title, supersetId, notes: r.exercise_notes ?? "", sets: [set] });
    }
  });
  return { workouts: [...workouts.values()], rowErrors };
}

function hash(v: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

export function resolveExercise(db: DB, title: string, created: { n: number }): number {
  const norm = normalizeExerciseName(title);
  const alias = db.prepare("SELECT exercise_id AS id FROM exercise_aliases WHERE alias_normalized = ?").get(norm) as { id: number } | undefined;
  if (alias) return alias.id;
  const ex = db.prepare("SELECT id FROM exercises WHERE normalized_name = ?").get(norm) as { id: number } | undefined;
  if (ex) return ex.id;
  created.n++;
  return Number(
    db.prepare("INSERT INTO exercises (name, normalized_name, kind, created_at) VALUES (?, ?, 'weighted', ?)").run(title.trim(), norm, Date.now())
      .lastInsertRowid,
  );
}

/** Re-infers the kind of exercises the user has not classified manually. */
export function refreshExerciseKinds(db: DB, exerciseIds: Iterable<number>): void {
  const getEx = db.prepare("SELECT name, kind_locked FROM exercises WHERE id = ?");
  const getSets = db.prepare(
    `SELECT es.set_type AS setType, es.weight_kg AS weightKg, es.reps, es.distance_m AS distanceM, es.duration_s AS durationS
     FROM exercise_sets es JOIN workout_exercises we ON we.id = es.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id WHERE we.exercise_id = ? AND w.deleted_at IS NULL`,
  );
  const setKind = db.prepare("UPDATE exercises SET kind = ? WHERE id = ?");
  for (const id of exerciseIds) {
    const ex = getEx.get(id) as { name: string; kind_locked: number } | undefined;
    if (!ex || ex.kind_locked) continue;
    setKind.run(inferKind(ex.name, getSets.all(id) as SetData[]), id);
  }
}

export function importHevyCsv(
  db: DB,
  text: string,
  opts: { tz: string; fileName?: string; removeMissing?: boolean; now?: number },
): HevyImportSummary {
  const now = opts.now ?? Date.now();
  const runId = Number(
    db
      .prepare("INSERT INTO import_runs (kind, source, sync_id, status, started_at, payload_bytes) VALUES ('hevy', 'hevy-csv', ?, 'failed', ?, ?)")
      .run(opts.fileName ?? null, now, Buffer.byteLength(text)).lastInsertRowid,
  );
  const summary: HevyImportSummary = { importRunId: runId, workouts: 0, accepted: 0, updated: 0, skipped: 0, rejected: 0, deleted: 0, removeSkipped: false, exercisesCreated: 0, rowErrors: [] };

  try {
    const { workouts, rowErrors } = parseHevyCsv(text, opts.tz);
    summary.workouts = workouts.length;
    summary.rejected = rowErrors.length;
    summary.rowErrors = rowErrors.slice(0, 50);
    const created = { n: 0 };
    const touched = new Set<number>();

    db.transaction(() => {
      const findWorkout = db.prepare("SELECT id, content_hash, deleted_at FROM workouts WHERE external_id = ?");
      // Same workout imported earlier under an id built from a differently formatted start_time.
      const findSame = db.prepare("SELECT id, content_hash, deleted_at FROM workouts WHERE source = ? AND title = ? AND start_ms = ? ORDER BY deleted_at IS NOT NULL LIMIT 1");
      const insertWe = db.prepare(
        "INSERT INTO workout_exercises (workout_id, exercise_id, position, source_title, superset_id, notes) VALUES (?, ?, ?, ?, ?, ?)",
      );
      const insertSet = db.prepare(
        `INSERT INTO exercise_sets (workout_exercise_id, set_index, set_type, weight_kg, reps, distance_m, duration_s, rpe)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const seen = new Set<string>();
      for (const w of workouts) {
        // Identity is title + parsed start instant, so a change in Hevy's date format doesn't create new workouts.
        const externalId = "hevy:" + hash([w.title, w.startMs]).slice(0, 40);
        seen.add(externalId);
        const contentHash = hash({ ...w, startRaw: undefined, key: externalId });
        type Existing = { id: number; content_hash: string; deleted_at: number | null };
        let existing = findWorkout.get(externalId) as Existing | undefined;
        if (!existing) {
          existing = (findWorkout.get("hevy:" + hash([w.title, w.startRaw]).slice(0, 40)) ?? findSame.get(HEVY_SOURCE, w.title, w.startMs)) as Existing | undefined;
          if (existing) db.prepare("UPDATE workouts SET external_id = ? WHERE id = ?").run(externalId, existing.id);
        }
        if (existing && existing.content_hash === contentHash && existing.deleted_at === null) {
          summary.skipped++;
          continue;
        }
        const fields = {
          title: w.title,
          startMs: w.startMs,
          endMs: w.endMs,
          durationS: w.endMs ? (w.endMs - w.startMs) / 1000 : null,
          notes: w.description || null,
          contentHash,
          runId,
          now,
        };
        let workoutId: number;
        if (existing) {
          db.prepare(
            `UPDATE workouts SET title=@title, start_ms=@startMs, end_ms=@endMs, duration_s=@durationS, notes=@notes,
             content_hash=@contentHash, import_run_id=@runId, updated_at=@now, deleted_at=NULL WHERE id=@id`,
          ).run({ ...fields, id: existing.id });
          db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?").run(existing.id);
          workoutId = existing.id;
          summary.updated++;
        } else {
          workoutId = Number(
            db
              .prepare(
                `INSERT INTO workouts (source, external_id, title, activity_type, start_ms, end_ms, duration_s, source_name, notes,
                 content_hash, import_run_id, created_at, updated_at)
                 VALUES ('${HEVY_SOURCE}', @externalId, @title, 'strength_training', @startMs, @endMs, @durationS, 'Hevy', @notes,
                 @contentHash, @runId, @now, @now)`,
              )
              .run({ ...fields, externalId }).lastInsertRowid,
          );
          summary.accepted++;
        }
        w.exercises.forEach((ex, pos) => {
          const exerciseId = resolveExercise(db, ex.title, created);
          touched.add(exerciseId);
          const weId = Number(insertWe.run(workoutId, exerciseId, pos, ex.title, ex.supersetId, ex.notes || null).lastInsertRowid);
          for (const s of ex.sets) insertSet.run(weId, s.index, s.setType, s.weightKg, s.reps, s.distanceM, s.durationS, s.rpe ?? null);
        });
      }
      // Only a fully understood export can say what is "missing"; otherwise everything would be removed.
      summary.removeSkipped = !!opts.removeMissing && (rowErrors.length > 0 || workouts.length === 0);
      if (opts.removeMissing && !summary.removeSkipped) {
        const all = db.prepare("SELECT id, external_id FROM workouts WHERE source = ? AND deleted_at IS NULL").all(HEVY_SOURCE) as {
          id: number;
          external_id: string;
        }[];
        const del = db.prepare("UPDATE workouts SET deleted_at = ?, updated_at = ? WHERE id = ?");
        for (const r of all) {
          if (!seen.has(r.external_id)) {
            del.run(now, now, r.id);
            summary.deleted++;
          }
        }
      }
      refreshExerciseKinds(db, touched);
    })();
    summary.exercisesCreated = created.n;

    db.prepare(
      `UPDATE import_runs SET status=?, finished_at=?, received=?, accepted=?, updated=?, skipped=?, rejected=?, deleted=?, details=? WHERE id=?`,
    ).run(
      summary.rejected ? "partial" : "success",
      Date.now(),
      workouts.length,
      summary.accepted,
      summary.updated,
      summary.skipped,
      summary.rejected,
      summary.deleted,
      JSON.stringify({ rowErrors: summary.rowErrors, exercisesCreated: summary.exercisesCreated }),
      runId,
    );
    return summary;
  } catch (err) {
    db.prepare("UPDATE import_runs SET status='failed', finished_at=?, error=? WHERE id=?").run(
      Date.now(),
      err instanceof Error ? err.message.slice(0, 500) : "unknown error",
      runId,
    );
    throw err;
  }
}
