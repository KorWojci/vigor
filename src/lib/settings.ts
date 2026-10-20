import { z } from "zod";
import type { DB } from "./db";
import { isValidTimeZone, RANGE_PRESETS } from "./time";

/**
 * Application settings, stored as JSON values in the `settings` table.
 * Each key has a schema and a default; invalid stored values fall back to the default.
 */
const rangeKeys = RANGE_PRESETS.map((r) => r.key) as [string, ...string[]];

export const DASHBOARD_TILES = [
  { key: "weight", label: "Body weight" },
  { key: "body_fat", label: "Body fat" },
  { key: "steps", label: "Steps" },
  { key: "active_energy", label: "Active energy" },
  { key: "exercise", label: "Exercise minutes" },
  { key: "sleep", label: "Sleep" },
  { key: "resting_hr", label: "Resting heart rate" },
  { key: "hrv", label: "Heart rate variability" },
  { key: "vo2max", label: "VO₂ max" },
  { key: "spo2", label: "Blood oxygen" },
  { key: "nutrition", label: "Nutrition" },
  { key: "training", label: "Training" },
] as const;
export type DashboardTileKey = (typeof DASHBOARD_TILES)[number]["key"];

export const settingsSchema = {
  profile: z
    .object({
      displayName: z.string().max(80).optional(),
      birthYear: z.number().int().min(1900).max(2100).optional(),
      sex: z.enum(["female", "male", "other", "unspecified"]).optional(),
    })
    .default({}),
  units: z.enum(["metric", "imperial"]).default("metric"),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Unknown time zone")
    .default(process.env.TZ && isValidTimeZone(process.env.TZ) ? process.env.TZ : "UTC"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  defaultRange: z.enum(rangeKeys).default("30d"),
  dashboardTiles: z
    .array(z.string())
    .default(["weight", "body_fat", "steps", "active_energy", "sleep", "resting_hr", "hrv", "vo2max", "nutrition", "training"]),
  movingAverageDays: z.union([z.literal(0), z.literal(7), z.literal(14), z.literal(30)]).default(7),
  syncIntervalMinutes: z.number().int().min(15).max(24 * 60).default(60),
} as const;

type Schemas = typeof settingsSchema;
export type SettingKey = keyof Schemas;
export type Settings = { [K in SettingKey]: z.infer<Schemas[K]> };

export function getSetting<K extends SettingKey>(db: DB, key: K): Settings[K] {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  const schema = settingsSchema[key];
  if (row) {
    try {
      const parsed = schema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data as Settings[K];
    } catch {
      // fall through to default
    }
  }
  return schema.parse(undefined) as Settings[K];
}

export function getSettings(db: DB): Settings {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(settingsSchema) as SettingKey[]) out[key] = getSetting(db, key);
  return out as Settings;
}

export function setSetting<K extends SettingKey>(db: DB, key: K, value: Settings[K]): Settings[K] {
  const parsed = settingsSchema[key].parse(value) as Settings[K];
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(parsed),
  );
  return parsed;
}
