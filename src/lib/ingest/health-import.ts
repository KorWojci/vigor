import crypto from "node:crypto";
import type { DB } from "../db";
import { getMetric, SLEEP_CATEGORIES, type SleepCategory } from "../metrics/catalog";
import { toCanonical } from "../units";
import {
  deletionSchema,
  envelopeSchema,
  MAX_REPLACE_WINDOW_DAYS,
  parseTimestamp,
  sampleSchema,
  workoutSchema,
  type ImportEnvelope,
} from "./schema";

/**
 * Health import processor — the heart of Apple Health synchronisation.
 *
 * Guarantees:
 *  - Idempotent: every sample has a unique external id (the HealthKit UUID when supplied, otherwise
 *    a deterministic hash of its content). Re-sending a sample never creates a duplicate.
 *  - Incremental: only the samples in the payload are touched. History is never replaced wholesale.
 *  - Corrections: a re-sent sample with the same external id but different content is updated.
 *  - Deletions: explicit `deleted` entries (HealthKit anchored-query deletions) soft-delete rows;
 *    `replaceWindows` let id-less sources (Shortcuts) declare a time window as complete, so
 *    rows from that same source in the window that were not re-sent are soft-deleted.
 *  - Atomic: the whole payload is applied in one transaction; cursors are stored only on success.
 *  - Retry-safe: a repeated request with the same syncId and identical body returns the stored
 *    summary without reprocessing.
 */

export interface ImportSummary {
  received: number;
  accepted: number;
  updated: number;
  skipped: number;
  rejected: number;
  deleted: number;
}

export interface Rejection {
  kind: "sample" | "workout" | "deletion" | "replaceWindow";
  index: number;
  reason: string;
}

export interface ImportResult {
  ok: true;
  importRunId: number;
  syncId: string;
  replayed: boolean;
  status: "success" | "partial";
  summary: ImportSummary;
  rejections: Rejection[];
  cursorsStored: number;
  serverTime: string;
}

export class ImportValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

const MAX_REPORTED_REJECTIONS = 100;
const FUTURE_TOLERANCE_MS = 24 * 3600_000;
const EARLIEST_MS = Date.UTC(1990, 0, 1);

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1e6) / 1e6;
}

interface NormalisedSample {
  type: string;
  value: number | null;
  unit: string;
  category: string | null;
  startMs: number;
  endMs: number;
  sourceName: string | null;
  sourceBundle: string | null;
  device: string | null;
  externalId: string;
  derived: boolean;
  metadata: string | null;
  contentHash: string;
}

/**
 * Maps sleep stage labels to Vigor categories. Accepts Vigor's own values, HealthKit enum names
 * (HKCategoryValueSleepAnalysis…) and the English labels Shortcuts shows ("Core", "In Bed", …).
 */
const SLEEP_ALIASES: Record<string, SleepCategory> = {
  inbed: "in_bed",
  awake: "awake",
  asleep: "asleep_unspecified",
  asleepunspecified: "asleep_unspecified",
  unspecified: "asleep_unspecified",
  core: "asleep_core",
  asleepcore: "asleep_core",
  light: "asleep_core",
  deep: "asleep_deep",
  asleepdeep: "asleep_deep",
  rem: "asleep_rem",
  asleeprem: "asleep_rem",
};

export function normaliseSleepCategory(raw: string): SleepCategory | null {
  const k = raw.toLowerCase().replace(/^hkcategoryvaluesleepanalysis/, "").replace(/[^a-z]/g, "");
  return SLEEP_ALIASES[k] ?? null;
}

/**
 * Start of the calendar day `timestamp` falls on, in the UTC offset `timestamp` itself carries
 * (not the server's time zone) — e.g. "2026-10-21T23:50:00+02:00" → ms for "2026-10-21T00:00:00+02:00".
 * Backs `replaceToday`: a client's "today" is whatever day it is where the client is, not in UTC.
 */
export function startOfDayFor(timestamp: string): number | null {
  const ms = parseTimestamp(timestamp);
  if (ms === null) return null;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(timestamp.trim());
  const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; // no match → "Z", offset 0
  const localMs = ms + offsetMin * 60_000;
  return Math.floor(localMs / 86_400_000) * 86_400_000 - offsetMin * 60_000;
}

/**
 * Parses a number sent as text. Accepts "1234", "80.4" and "80,4" (comma decimal locales) and
 * ignores spaces used as thousands separators. Returns null for anything else, including
 * "1,234" / "1.234,5", where the separator meaning depends on the phone's locale.
 */
export function parseNumericText(raw: string): number | null {
  const t = raw.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  if (/^-?\d+,\d{3}$/.test(t)) return null; // thousands separator or decimal comma — ambiguous
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Validates and normalises one sample. Returns a string reason when it must be rejected. */
export function normaliseSample(raw: unknown, source: string, now = Date.now()): NormalisedSample | string {
  const parsed = sampleSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join(".") || "sample"}: ${i.message}`).join("; ");
  }
  const s = parsed.data;
  const def = getMetric(s.type);
  if (!def) return `unsupported metric type '${s.type}'`;

  const startMs = parseTimestamp(s.startAt);
  if (startMs === null) return "startAt must be an ISO 8601 timestamp with a UTC offset";
  const endMs = s.endAt ? parseTimestamp(s.endAt) : startMs;
  if (endMs === null) return "endAt must be an ISO 8601 timestamp with a UTC offset";
  if (endMs < startMs) return "endAt is before startAt";
  if (startMs < EARLIEST_MS) return "startAt is implausibly old";
  if (endMs > now + FUTURE_TOLERANCE_MS) return "sample lies in the future";

  let value: number | null;
  let category: string | null = null;
  if (def.aggregation === "sleep") {
    // Shortcuts' "Value" of a sleep sample is the stage label, so accept it from `value` too.
    const label = s.category ?? (typeof s.value === "string" ? s.value : "");
    const cat = normaliseSleepCategory(label);
    if (!cat) return `sleep_analysis requires category in: ${SLEEP_CATEGORIES.join(", ")}`;
    if (endMs - startMs > 24 * 3600_000) return "sleep sample longer than 24 hours";
    category = cat;
    value = (endMs - startMs) / 60_000;
  } else {
    if (s.value === null || s.value === undefined || s.value === "") return "value is required";
    const raw = typeof s.value === "string" ? parseNumericText(s.value) : s.value;
    if (raw === null) return `value '${s.value}' is not an unambiguous number; send it as a JSON number`;
    const unit = s.unit ?? "";
    let converted = toCanonical(raw, unit, def.unit);
    if (converted === null && unit === "" && def.unit === "count") converted = raw;
    if (converted === null) return `unit '${unit}' cannot be converted to ${def.unit} for ${def.key}`;
    if (converted < 0 && def.unit !== "°c") return "negative value";
    // HealthKit percent quantities are fractions (0–1) while Shortcuts renders them as 0–100.
    // Clients should send unit "fraction" for 0–1 values; a "%" value ≤ 1 is physiologically
    // impossible for the catalogued percentages (SpO₂, body fat) and is treated as a fraction.
    if (def.unit === "%" && unit.trim() === "%" && converted > 0 && converted <= 1) {
      converted = converted * 100;
    }
    if (def.unit === "%" && converted > 100) return "percentage above 100";
    value = converted;
    // Only sleep is a category type; a generic Shortcut loop may fill `category` for every type.
    category = null;
  }

  const sourceName = s.sourceName?.trim() || null;
  const metadata = s.metadata && Object.keys(s.metadata).length ? stableJson(s.metadata) : null;
  const contentHash = sha256(
    stableJson([s.type, round(value), def.unit, category, startMs, endMs, sourceName, s.sourceBundleId ?? null, s.device ?? null, metadata]),
  );
  const derived = !s.externalId;
  const externalId = s.externalId
    ? s.externalId.trim()
    : "derived:" + sha256(stableJson([source, s.type, category, startMs, endMs, round(value), sourceName]));

  return {
    type: s.type,
    value,
    unit: def.unit,
    category,
    startMs,
    endMs,
    sourceName,
    sourceBundle: s.sourceBundleId ?? null,
    device: s.device ?? null,
    externalId,
    derived,
    metadata,
    contentHash,
  };
}

interface NormalisedWorkout {
  externalId: string;
  activityType: string;
  title: string | null;
  startMs: number;
  endMs: number;
  durationS: number;
  energyKcal: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  sourceName: string | null;
  metadata: string | null;
  contentHash: string;
}

export function normaliseWorkout(raw: unknown, source: string, now = Date.now()): NormalisedWorkout | string {
  const parsed = workoutSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".") || "workout"}: ${i.message}`).join("; ");
  const w = parsed.data;
  const startMs = parseTimestamp(w.startAt);
  const endMs = parseTimestamp(w.endAt);
  if (startMs === null || endMs === null) return "startAt/endAt must be ISO 8601 timestamps with a UTC offset";
  if (endMs < startMs) return "endAt is before startAt";
  if (endMs > now + FUTURE_TOLERANCE_MS) return "workout lies in the future";
  const metadata = w.metadata && Object.keys(w.metadata).length ? stableJson(w.metadata) : null;
  const fields = {
    activityType: w.activityType,
    title: w.title ?? null,
    startMs,
    endMs,
    durationS: w.durationSeconds ?? (endMs - startMs) / 1000,
    energyKcal: w.energyKcal ?? null,
    distanceM: w.distanceMeters ?? null,
    avgHr: w.avgHeartRate ?? null,
    maxHr: w.maxHeartRate ?? null,
    sourceName: w.sourceName?.trim() || null,
    metadata,
  };
  return {
    ...fields,
    externalId: w.externalId?.trim() || "derived:" + sha256(stableJson([source, "workout", w.activityType, startMs, endMs, fields.sourceName])),
    contentHash: sha256(stableJson(fields)),
  };
}

/** Validates the envelope. Throws ImportValidationError for malformed requests. */
export function parseEnvelope(body: unknown): ImportEnvelope {
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ImportValidationError(
      "Invalid import payload",
      parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    );
  }
  if (parseTimestamp(parsed.data.generatedAt) === null) {
    throw new ImportValidationError("Invalid import payload", ["generatedAt: must be an ISO 8601 timestamp with a UTC offset"]);
  }
  return parsed.data;
}

export interface ImportOptions {
  rawBody: string;
  tokenId?: number;
  now?: number;
}

export function importHealthPayload(db: DB, body: unknown, opts: ImportOptions): ImportResult {
  const env = parseEnvelope(body);
  const now = opts.now ?? Date.now();
  const payloadHash = sha256(opts.rawBody);

  // Retry of an identical, already-applied request: return the original result.
  const previous = db
    .prepare(
      `SELECT id, status, received, accepted, updated, skipped, rejected, deleted, details FROM import_runs
       WHERE kind = 'health' AND source = ? AND sync_id = ? AND payload_hash = ? AND status IN ('success','partial')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(env.source, env.syncId, payloadHash) as
    | (ImportSummary & { id: number; status: "success" | "partial"; details: string | null })
    | undefined;
  if (previous) {
    const details = previous.details ? JSON.parse(previous.details) : {};
    return {
      ok: true,
      importRunId: previous.id,
      syncId: env.syncId,
      replayed: true,
      status: previous.status,
      summary: {
        received: previous.received,
        accepted: previous.accepted,
        updated: previous.updated,
        skipped: previous.skipped,
        rejected: previous.rejected,
        deleted: previous.deleted,
      },
      rejections: details.rejections ?? [],
      cursorsStored: details.cursorsStored ?? 0,
      serverTime: new Date(now).toISOString(),
    };
  }

  const runId = Number(
    db
      .prepare(
        `INSERT INTO import_runs (kind, source, sync_id, payload_hash, status, started_at, payload_bytes, token_id)
         VALUES ('health', ?, ?, ?, 'failed', ?, ?, ?)`,
      )
      .run(env.source, env.syncId, payloadHash, now, Buffer.byteLength(opts.rawBody), opts.tokenId ?? null).lastInsertRowid,
  );

  const summary: ImportSummary = {
    received: env.samples.length + env.workouts.length + env.deleted.length,
    accepted: 0,
    updated: 0,
    skipped: 0,
    rejected: 0,
    deleted: 0,
  };
  const rejections: Rejection[] = [];
  const reject = (kind: Rejection["kind"], index: number, reason: string) => {
    summary.rejected++;
    if (rejections.length < MAX_REPORTED_REJECTIONS) rejections.push({ kind, index, reason });
  };

  const findSample = db.prepare("SELECT id, content_hash, deleted_at FROM health_samples WHERE external_id = ?");
  const insertSample = db.prepare(
    `INSERT INTO health_samples (type, value, unit, category, start_ms, end_ms, source, source_name, source_bundle, device,
       external_id, external_id_derived, content_hash, metadata, import_run_id, created_at, updated_at)
     VALUES (@type, @value, @unit, @category, @startMs, @endMs, @source, @sourceName, @sourceBundle, @device,
       @externalId, @derived, @contentHash, @metadata, @runId, @now, @now)`,
  );
  const updateSample = db.prepare(
    `UPDATE health_samples SET type=@type, value=@value, unit=@unit, category=@category, start_ms=@startMs, end_ms=@endMs,
       source=@source, source_name=@sourceName, source_bundle=@sourceBundle, device=@device, content_hash=@contentHash,
       metadata=@metadata, import_run_id=@runId, updated_at=@now, deleted_at=NULL
     WHERE id=@id`,
  );
  const findWorkout = db.prepare("SELECT id, content_hash, deleted_at FROM workouts WHERE external_id = ?");
  const insertWorkout = db.prepare(
    `INSERT INTO workouts (source, external_id, title, activity_type, start_ms, end_ms, duration_s, energy_kcal, distance_m,
       avg_hr, max_hr, source_name, metadata, content_hash, import_run_id, created_at, updated_at)
     VALUES (@source, @externalId, @title, @activityType, @startMs, @endMs, @durationS, @energyKcal, @distanceM,
       @avgHr, @maxHr, @sourceName, @metadata, @contentHash, @runId, @now, @now)`,
  );
  const updateWorkout = db.prepare(
    `UPDATE workouts SET title=@title, activity_type=@activityType, start_ms=@startMs, end_ms=@endMs, duration_s=@durationS,
       energy_kcal=@energyKcal, distance_m=@distanceM, avg_hr=@avgHr, max_hr=@maxHr, source_name=@sourceName,
       metadata=@metadata, content_hash=@contentHash, import_run_id=@runId, updated_at=@now, deleted_at=NULL
     WHERE id=@id`,
  );

  let cursorsStored = 0;
  const apply = db.transaction(() => {
    const seenByType = new Map<string, Set<string>>();

    env.samples.forEach((raw, index) => {
      const s = normaliseSample(raw, env.source, now);
      if (typeof s === "string") return reject("sample", index, s);
      if (!seenByType.has(s.type)) seenByType.set(s.type, new Set());
      seenByType.get(s.type)!.add(s.externalId);
      const existing = findSample.get(s.externalId) as { id: number; content_hash: string; deleted_at: number | null } | undefined;
      const params = { ...s, derived: s.derived ? 1 : 0, source: env.source, runId, now };
      if (!existing) {
        insertSample.run(params);
        summary.accepted++;
      } else if (existing.content_hash === s.contentHash && existing.deleted_at === null) {
        summary.skipped++;
      } else {
        updateSample.run({ ...params, id: existing.id });
        summary.updated++;
      }
    });

    // `replaceToday`: if the client didn't declare any explicit replaceWindows, synthesize one
    // per type that had at least one valid sample this run, spanning from local midnight (by
    // `generatedAt`'s own offset) to `generatedAt`. An explicit `replaceWindows` always wins —
    // this only fills in when the client omitted it entirely.
    if (env.replaceWindows.length === 0 && env.replaceToday && seenByType.size > 0) {
      const dayStartMs = startOfDayFor(env.generatedAt);
      const generatedAtMs = parseTimestamp(env.generatedAt);
      if (dayStartMs !== null && generatedAtMs !== null) {
        const startAt = new Date(dayStartMs).toISOString();
        const endAt = new Date(generatedAtMs).toISOString();
        for (const type of seenByType.keys()) env.replaceWindows.push({ type, startAt, endAt });
      }
    }

    env.workouts.forEach((raw, index) => {
      const w = normaliseWorkout(raw, env.source, now);
      if (typeof w === "string") return reject("workout", index, w);
      const existing = findWorkout.get(w.externalId) as { id: number; content_hash: string; deleted_at: number | null } | undefined;
      const params = { ...w, source: env.source, runId, now };
      if (!existing) {
        insertWorkout.run(params);
        summary.accepted++;
      } else if (existing.content_hash === w.contentHash && existing.deleted_at === null) {
        summary.skipped++;
      } else {
        updateWorkout.run({ ...params, id: existing.id });
        summary.updated++;
      }
    });

    env.deleted.forEach((raw, index) => {
      const parsed = deletionSchema.safeParse(raw);
      if (!parsed.success) return reject("deletion", index, "deletion entries need an externalId");
      const table = parsed.data.kind === "workout" ? "workouts" : "health_samples";
      const res = db
        .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE external_id = ? AND deleted_at IS NULL`)
        .run(now, now, parsed.data.externalId);
      if (res.changes > 0) summary.deleted++;
      else summary.skipped++; // unknown or already deleted — nothing to do, safe on retry
    });

    env.replaceWindows.forEach((w, index) => {
      const startMs = parseTimestamp(w.startAt);
      const endMs = parseTimestamp(w.endAt);
      if (!getMetric(w.type)) return reject("replaceWindow", index, `unsupported metric type '${w.type}'`);
      if (startMs === null || endMs === null || endMs <= startMs) return reject("replaceWindow", index, "invalid window bounds");
      if (endMs - startMs > MAX_REPLACE_WINDOW_DAYS * 24 * 3600_000) {
        return reject("replaceWindow", index, `window longer than ${MAX_REPLACE_WINDOW_DAYS} days`);
      }
      const keep = seenByType.get(w.type) ?? new Set<string>();
      const candidates = db
        .prepare(
          `SELECT id, external_id FROM health_samples WHERE source = ? AND type = ? AND start_ms >= ? AND start_ms < ?
           AND deleted_at IS NULL`,
        )
        .all(env.source, w.type, startMs, endMs) as { id: number; external_id: string }[];
      const del = db.prepare("UPDATE health_samples SET deleted_at = ?, updated_at = ? WHERE id = ?");
      for (const c of candidates) {
        if (!keep.has(c.external_id)) {
          del.run(now, now, c.id);
          summary.deleted++;
        }
      }
    });

    const upsertCursor = db.prepare(
      `INSERT INTO sync_cursors (source, scope, cursor, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(source, scope) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    );
    for (const c of env.cursors) {
      upsertCursor.run(env.source, c.scope, c.value, now);
      cursorsStored++;
    }
  });

  try {
    apply();
  } catch (err) {
    db.prepare("UPDATE import_runs SET status='failed', finished_at=?, received=?, error=? WHERE id=?").run(
      Date.now(),
      summary.received,
      err instanceof Error ? err.message.slice(0, 500) : "unknown error",
      runId,
    );
    throw err;
  }

  const status = summary.rejected > 0 ? "partial" : "success";
  db.prepare(
    `UPDATE import_runs SET status=?, finished_at=?, received=?, accepted=?, updated=?, skipped=?, rejected=?, deleted=?,
       details=? WHERE id=?`,
  ).run(
    status,
    Date.now(),
    summary.received,
    summary.accepted,
    summary.updated,
    summary.skipped,
    summary.rejected,
    summary.deleted,
    JSON.stringify({ rejections, cursorsStored, device: env.device ?? null, generatedAt: env.generatedAt }),
    runId,
  );

  return {
    ok: true,
    importRunId: runId,
    syncId: env.syncId,
    replayed: false,
    status,
    summary,
    rejections,
    cursorsStored,
    serverTime: new Date(now).toISOString(),
  };
}

/**
 * Soft-deletes one imported sample by its row id (the manual "Recent samples" delete button in
 * the UI, as opposed to the `deleted[]` array in the import API, which deletes by `externalId`).
 * Kept as a tombstone, like every other deletion path, so a later re-send of the same content is
 * recognised rather than silently reviving it. Returns false if the row was already gone.
 */
export function deleteSampleById(db: DB, id: number): boolean {
  const now = Date.now();
  const res = db.prepare("UPDATE health_samples SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, now, id);
  return res.changes > 0;
}

/** Records a request that was authenticated but rejected before processing (bad JSON, schema, size). */
export function recordRejectedImport(
  db: DB,
  info: { source?: string; syncId?: string; error: string; bytes?: number; tokenId?: number; issues?: string[] },
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO import_runs (kind, source, sync_id, status, started_at, finished_at, payload_bytes, error, details, token_id)
     VALUES ('health', ?, ?, 'rejected', ?, ?, ?, ?, ?, ?)`,
  ).run(
    info.source ?? "unknown",
    info.syncId ?? null,
    now,
    now,
    info.bytes ?? null,
    info.error.slice(0, 500),
    info.issues ? JSON.stringify({ issues: info.issues.slice(0, 20) }) : null,
    info.tokenId ?? null,
  );
}
