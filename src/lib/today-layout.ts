/**
 * Layout of the Today page's metric sections: which metrics are always visible, which are
 * collapsed behind "Show more", and in what order — configurable the same way the Dashboard
 * layout is (see dashboard-layout.ts, which this mirrors).
 *
 * Each section only offers the metrics from its own catalog group, so a saved layout can't mix
 * nutrition metrics into the activity section.
 */
import { METRICS } from "./metrics/catalog";

export const TODAY_SECTIONS = ["activity", "heart", "nutrition"] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

export const TODAY_SECTION_LABELS: Record<TodaySection, string> = {
  activity: "Activity",
  heart: "Heart & recovery",
  nutrition: "Nutrition",
};

export const TODAY_COLUMNS = ["visible", "more"] as const;
export type TodayColumn = (typeof TODAY_COLUMNS)[number];
export const TODAY_COLUMN_LABELS: Record<TodayColumn, string> = { visible: "Always visible", more: "Under “Show more”" };

/** Candidate metrics per section, in catalog order. Heart rate itself is the separate "Right now" line, not configurable here. */
export const TODAY_SECTION_METRICS: Record<TodaySection, string[]> = {
  activity: METRICS.filter((m) => m.group === "activity").map((m) => m.key),
  heart: METRICS.filter((m) => m.group === "cardio" && m.key !== "heart_rate").map((m) => m.key),
  nutrition: METRICS.filter((m) => m.group === "nutrition").map((m) => m.key),
};

export type TodaySectionLayout = Record<TodayColumn, string[]>;
export type TodayLayout = Record<TodaySection, TodaySectionLayout>;

export const DEFAULT_TODAY_LAYOUT: TodayLayout = {
  activity: {
    visible: ["step_count", "distance_walking_running", "active_energy", "exercise_time"],
    more: ["basal_energy", "flights_climbed", "stand_hours"],
  },
  heart: {
    visible: ["resting_heart_rate", "heart_rate_variability"],
    more: ["oxygen_saturation", "respiratory_rate", "walking_heart_rate", "heart_rate_recovery", "vo2_max"],
  },
  nutrition: {
    visible: ["dietary_energy", "dietary_protein", "dietary_carbohydrates", "dietary_fat"],
    more: ["dietary_water", "dietary_fiber", "dietary_sugar", "dietary_sodium", "dietary_caffeine"],
  },
};

/** Drops unknown/duplicate/cross-section keys. A metric missing from the input lands in "more" so a newly added catalog metric shows up instead of silently vanishing. Never throws. */
export function normalizeTodayLayout(input: unknown): TodayLayout {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as TodayLayout;
  for (const section of TODAY_SECTIONS) {
    const allowed = new Set(TODAY_SECTION_METRICS[section]);
    const seen = new Set<string>();
    const layout: TodaySectionLayout = { visible: [], more: [] };
    const rawSection = (src[section] && typeof src[section] === "object" ? src[section] : {}) as Record<string, unknown>;
    for (const col of TODAY_COLUMNS) {
      const list = Array.isArray(rawSection[col]) ? (rawSection[col] as unknown[]) : [];
      for (const k of list) {
        if (typeof k === "string" && allowed.has(k) && !seen.has(k)) {
          seen.add(k);
          layout[col].push(k);
        }
      }
    }
    for (const k of TODAY_SECTION_METRICS[section]) if (!seen.has(k)) layout.more.push(k);
    out[section] = layout;
  }
  return out;
}

function locate(layout: TodayLayout, section: TodaySection, key: string): { column: TodayColumn; index: number } | null {
  for (const column of TODAY_COLUMNS) {
    const index = layout[section][column].indexOf(key);
    if (index >= 0) return { column, index };
  }
  return null;
}

/** Moves `key` within `section` to `column` at `index` (clamped; omitted = end). Returns a new layout. */
export function moveTodayMetric(layout: TodayLayout, section: TodaySection, key: string, column: TodayColumn, index?: number): TodayLayout {
  if (!TODAY_SECTION_METRICS[section].includes(key)) return layout;
  const from = locate(layout, section, key);
  const cur = layout[section];
  const next: TodaySectionLayout = { visible: cur.visible.filter((k) => k !== key), more: cur.more.filter((k) => k !== key) };
  let at = index ?? next[column].length;
  // Moving down within the same column: the removal shifted later items up by one.
  if (from && from.column === column && index !== undefined && index > from.index) at -= 1;
  at = Math.max(0, Math.min(at, next[column].length));
  next[column].splice(at, 0, key);
  return { ...layout, [section]: next };
}

/** Moves a metric one step up/down within its column, crossing into the other column at the edges. */
export function nudgeTodayMetric(layout: TodayLayout, section: TodaySection, key: string, dir: -1 | 1): TodayLayout {
  const pos = locate(layout, section, key);
  if (!pos) return layout;
  const cur = layout[section];
  const target = pos.index + dir;
  if (target >= 0 && target < cur[pos.column].length) return moveTodayMetric(layout, section, key, pos.column, dir === 1 ? target + 1 : target);
  const ci = TODAY_COLUMNS.indexOf(pos.column) + dir;
  if (ci < 0 || ci >= TODAY_COLUMNS.length) return layout;
  const column = TODAY_COLUMNS[ci];
  return moveTodayMetric(layout, section, key, column, dir === 1 ? 0 : cur[column].length);
}
