import { z } from "zod";
import type { DB } from "./db";
import { isValidTimeZone, RANGE_PRESETS } from "./time";
import { DEFAULT_LAYOUT, layoutFromLegacyTiles, normalizeLayout, ZONES, type DashboardLayout } from "./dashboard-layout";
import { DEFAULT_TODAY_LAYOUT, normalizeTodayLayout, TODAY_COLUMNS, TODAY_SECTIONS, type TodayLayout } from "./today-layout";

/**
 * Application settings, stored as JSON values in the `settings` table.
 * Each key has a schema and a default; invalid stored values fall back to the default.
 */
const rangeKeys = RANGE_PRESETS.map((r) => r.key) as [string, ...string[]];

export const settingsSchema = {
  profile: z
    .object({
      displayName: z.string().max(80).optional(),
      birthYear: z.number().int().min(1900).max(2100).optional(),
      sex: z.enum(["female", "male", "other", "unspecified"]).optional(),
      /** Used for heart-rate zones; when absent, 220 − age or the highest recorded value is used. */
      maxHeartRate: z.number().int().min(100).max(240).optional(),
    })
    .default({}),
  units: z.enum(["metric", "imperial"]).default("metric"),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Unknown time zone")
    .default(process.env.TZ && isValidTimeZone(process.env.TZ) ? process.env.TZ : "UTC"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  defaultRange: z.enum(rangeKeys).default("30d"),
  /** @deprecated superseded by dashboardLayout; still read when no layout has been saved. */
  dashboardTiles: z
    .array(z.string())
    .default(["weight", "body_fat", "steps", "active_energy", "sleep", "resting_hr", "hrv", "vo2max", "nutrition", "training"]),
  /** Widget placement on the dashboard (see src/lib/dashboard-layout.ts). */
  dashboardLayout: z
    .object(Object.fromEntries(ZONES.map((zn) => [zn, z.array(z.string()).max(50)])) as Record<(typeof ZONES)[number], z.ZodArray<z.ZodString>>)
    .transform(normalizeLayout)
    .optional(),
  /** Today page: which metrics are always visible vs. under "Show more", per section, and in what order (see today-layout.ts). */
  todayLayout: z
    .object(
      Object.fromEntries(
        TODAY_SECTIONS.map((sec) => [sec, z.object(Object.fromEntries(TODAY_COLUMNS.map((col) => [col, z.array(z.string()).max(30)])) as Record<(typeof TODAY_COLUMNS)[number], z.ZodArray<z.ZodString>>)]),
      ) as Record<(typeof TODAY_SECTIONS)[number], z.ZodObject<Record<(typeof TODAY_COLUMNS)[number], z.ZodArray<z.ZodString>>>>,
    )
    .transform(normalizeTodayLayout)
    .optional(),
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

/** The dashboard layout: the saved one, else derived from the legacy tile list, else the default. */
export function getDashboardLayout(db: DB): DashboardLayout {
  const saved = getSetting(db, "dashboardLayout");
  if (saved) return saved;
  const legacy = db.prepare("SELECT 1 FROM settings WHERE key = 'dashboardTiles'").get();
  return legacy ? layoutFromLegacyTiles(getSetting(db, "dashboardTiles")) : normalizeLayout(DEFAULT_LAYOUT);
}

/** The Today page layout: the saved one, else the default. */
export function getTodayLayout(db: DB): TodayLayout {
  return getSetting(db, "todayLayout") ?? DEFAULT_TODAY_LAYOUT;
}
