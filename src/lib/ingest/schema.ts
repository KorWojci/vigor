import { z } from "zod";

/**
 * Versioned JSON contract for POST /api/v1/health/import.
 * Documented in docs/import-api.md — keep both in sync.
 *
 * The envelope is validated strictly (a malformed envelope rejects the whole request with 400);
 * individual samples/workouts/deletions are validated one by one so a single bad record
 * does not discard an otherwise good batch.
 */
export const SCHEMA_VERSION = 1;
export const MAX_SAMPLES_PER_REQUEST = 50_000;
export const MAX_WORKOUTS_PER_REQUEST = 2_000;
export const MAX_DELETIONS_PER_REQUEST = 50_000;
export const MAX_REPLACE_WINDOW_DAYS = 62;

const timestamp = z.string().min(10).max(40);
const sourceId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, "source must contain only letters, digits, '.', '_' or '-'");

export const envelopeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION, {
    errorMap: () => ({ message: `schemaVersion must be ${SCHEMA_VERSION}` }),
  }),
  source: sourceId,
  syncId: z.string().min(1).max(128),
  generatedAt: timestamp,
  device: z
    .object({
      name: z.string().max(120).optional(),
      model: z.string().max(120).optional(),
      systemVersion: z.string().max(40).optional(),
      appVersion: z.string().max(40).optional(),
      timeZone: z.string().max(64).optional(),
    })
    .partial()
    .optional(),
  samples: z.array(z.unknown()).max(MAX_SAMPLES_PER_REQUEST).optional().default([]),
  workouts: z.array(z.unknown()).max(MAX_WORKOUTS_PER_REQUEST).optional().default([]),
  deleted: z.array(z.unknown()).max(MAX_DELETIONS_PER_REQUEST).optional().default([]),
  replaceWindows: z
    .array(z.object({ type: z.string().min(1).max(64), startAt: timestamp, endAt: timestamp }))
    .max(200)
    .optional()
    .default([]),
  cursors: z
    .array(z.object({ scope: z.string().min(1).max(100), value: z.string().max(65_536) }))
    .max(200)
    .optional()
    .default([]),
});
export type ImportEnvelope = z.infer<typeof envelopeSchema>;

const metadata = z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional();

export const sampleSchema = z.object({
  type: z.string().min(1).max(64),
  // A string is accepted for clients that cannot type their JSON (Shortcuts): a plain number
  // ("80.4", "80,4") or, for category types, the category label. See normaliseSample.
  value: z.union([z.number().finite(), z.string().max(64)]).optional().nullable(),
  unit: z.string().max(32).optional().default(""),
  category: z.string().max(64).optional().nullable(),
  startAt: timestamp,
  endAt: timestamp.optional().nullable(),
  sourceName: z.string().max(200).optional().nullable(),
  sourceBundleId: z.string().max(200).optional().nullable(),
  device: z.string().max(200).optional().nullable(),
  externalId: z.string().min(1).max(200).optional().nullable(),
  metadata,
});
export type SampleInput = z.infer<typeof sampleSchema>;

export const workoutSchema = z.object({
  activityType: z.string().min(1).max(80),
  title: z.string().max(200).optional().nullable(),
  startAt: timestamp,
  endAt: timestamp,
  durationSeconds: z.number().finite().nonnegative().optional().nullable(),
  energyKcal: z.number().finite().nonnegative().optional().nullable(),
  distanceMeters: z.number().finite().nonnegative().optional().nullable(),
  avgHeartRate: z.number().finite().positive().optional().nullable(),
  maxHeartRate: z.number().finite().positive().optional().nullable(),
  sourceName: z.string().max(200).optional().nullable(),
  externalId: z.string().min(1).max(200).optional().nullable(),
  metadata,
});
export type WorkoutInput = z.infer<typeof workoutSchema>;

export const deletionSchema = z.object({
  externalId: z.string().min(1).max(200),
  kind: z.enum(["sample", "workout"]).optional().default("sample"),
});

/**
 * Parses a timestamp that carries explicit time-zone information (Z or ±hh:mm).
 * Ambiguous local timestamps are rejected rather than guessed.
 */
export function parseTimestamp(s: string): number | null {
  const trimmed = s.trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return null;
  // Accept "2026-10-20 08:00:00 +0200" (a common Shortcuts rendering) as well as ISO 8601.
  const normalised = trimmed
    .replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*/, "$1T$2")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? ms : null;
}
