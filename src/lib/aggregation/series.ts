import type { DB } from "../db";
import { MEASUREMENT_METRIC_LINKS } from "../body/measurement-types";
import { getMetric, type MetricDef } from "../metrics/catalog";
import type { DateRange } from "../time";
import { aggregateDaily, aggregateSleep, type DayValue, type RawSample, type SleepNight } from "./aggregate";

/**
 * Data-access + aggregation for metric time series. Aggregates are computed on read from the
 * raw samples, so late-arriving samples, corrections and deletions are reflected immediately —
 * there are no cached daily totals to invalidate.
 */
const MARGIN_MS = 24 * 3600_000; // time-zone & sleep-day margin when loading samples

const metricToMeasurement: Record<string, string> = Object.fromEntries(
  Object.entries(MEASUREMENT_METRIC_LINKS).map(([m, metric]) => [metric, m]),
);

export function loadRawSamples(db: DB, metricKey: string, startMs: number, endMs: number): RawSample[] {
  const rows = db
    .prepare(
      `SELECT start_ms AS startMs, end_ms AS endMs, value, category, source_name AS sourceName, source
       FROM health_samples WHERE type = ? AND deleted_at IS NULL AND start_ms < ? AND end_ms >= ?
       ORDER BY start_ms`,
    )
    .all(metricKey, endMs, startMs) as RawSample[];
  const measurementKey = metricToMeasurement[metricKey];
  if (measurementKey) {
    const manual = db
      .prepare(
        `SELECT measured_at AS startMs, measured_at AS endMs, value, NULL AS category, 'Manual entry' AS sourceName,
         'manual' AS source FROM body_measurements WHERE type_key = ? AND measured_at >= ? AND measured_at < ?`,
      )
      .all(measurementKey, startMs, endMs) as RawSample[];
    rows.push(...manual);
  }
  return rows;
}

function inRange<T extends { day: string }>(items: T[], range: DateRange): T[] {
  return items.filter((d) => d.day >= range.from && d.day <= range.to);
}

export function getDailySeries(db: DB, metricKey: string, range: DateRange, tz: string): DayValue[] {
  const def = getMetric(metricKey);
  if (!def) return [];
  const samples = loadRawSamples(db, metricKey, range.startMs - MARGIN_MS, range.endMs + MARGIN_MS);
  return inRange(aggregateDaily(def, samples, tz), range);
}

export function getSleepNights(db: DB, range: DateRange, tz: string): SleepNight[] {
  const samples = loadRawSamples(db, "sleep_analysis", range.startMs - MARGIN_MS, range.endMs + MARGIN_MS);
  return inRange(aggregateSleep(samples, tz), range);
}

export interface Reading {
  value: number;
  at: number;
  sourceName: string;
}

/** Most recent individual reading at or before `beforeMs` (samples and linked manual entries). */
export function getLatestReading(db: DB, metricKey: string, beforeMs = Date.now() + MARGIN_MS): Reading | null {
  const sample = db
    .prepare(
      `SELECT value, end_ms AS at, COALESCE(source_name, source) AS sourceName FROM health_samples
       WHERE type = ? AND deleted_at IS NULL AND value IS NOT NULL AND end_ms <= ? ORDER BY end_ms DESC, id DESC LIMIT 1`,
    )
    .get(metricKey, beforeMs) as Reading | undefined;
  const mKey = metricToMeasurement[metricKey];
  const manual = mKey
    ? (db
        .prepare(
          `SELECT value, measured_at AS at, 'Manual entry' AS sourceName FROM body_measurements
           WHERE type_key = ? AND measured_at <= ? ORDER BY measured_at DESC, id DESC LIMIT 1`,
        )
        .get(mKey, beforeMs) as Reading | undefined)
    : undefined;
  if (sample && manual) return manual.at >= sample.at ? manual : sample;
  return sample ?? manual ?? null;
}

export interface MetricSummary {
  def: MetricDef;
  daily: DayValue[];
  /** Representative value of the period: daily mean for sum/avg/sleep, last value for latest. */
  value: number | null;
  previous: number | null;
  latest: Reading | null;
  daysWithData: number;
  sources: string[];
}

function periodValue(def: MetricDef, daily: DayValue[]): number | null {
  if (!daily.length) return null;
  if (def.aggregation === "latest") return daily[daily.length - 1].value;
  return daily.reduce((a, d) => a + d.value, 0) / daily.length;
}

export function getMetricSummary(db: DB, metricKey: string, range: DateRange, previous: DateRange, tz: string): MetricSummary | null {
  const def = getMetric(metricKey);
  if (!def) return null;
  const daily = getDailySeries(db, metricKey, range, tz);
  let prevValue: number | null;
  if (def.aggregation === "latest") {
    prevValue = getLatestReading(db, metricKey, range.startMs)?.value ?? null;
  } else {
    prevValue = periodValue(def, getDailySeries(db, metricKey, previous, tz));
  }
  let latest: Reading | null;
  if (def.aggregation === "latest") latest = getLatestReading(db, metricKey, range.endMs);
  else {
    const last = daily[daily.length - 1];
    latest = last ? { value: last.value, at: Date.parse(last.day + "T12:00:00Z"), sourceName: last.sources.join(", ") } : null;
  }
  return {
    def,
    daily,
    value: def.aggregation === "latest" ? (latest?.value ?? null) : periodValue(def, daily),
    previous: prevValue,
    latest,
    daysWithData: daily.length,
    sources: [...new Set(daily.flatMap((d) => d.sources))],
  };
}

export interface MetricInventory {
  type: string;
  samples: number;
  firstMs: number | null;
  lastMs: number | null;
}

/** Sample counts per metric type, including linked manual measurements. */
export function getMetricInventory(db: DB): Map<string, MetricInventory> {
  const rows = db
    .prepare(
      `SELECT type, COUNT(*) AS samples, MIN(start_ms) AS firstMs, MAX(end_ms) AS lastMs FROM health_samples
       WHERE deleted_at IS NULL GROUP BY type`,
    )
    .all() as MetricInventory[];
  const map = new Map(rows.map((r) => [r.type, r]));
  const manual = db
    .prepare("SELECT type_key AS k, COUNT(*) AS n, MIN(measured_at) AS f, MAX(measured_at) AS l FROM body_measurements GROUP BY type_key")
    .all() as { k: string; n: number; f: number; l: number }[];
  for (const m of manual) {
    const metric = MEASUREMENT_METRIC_LINKS[m.k];
    if (!metric) continue;
    const cur = map.get(metric);
    map.set(metric, {
      type: metric,
      samples: (cur?.samples ?? 0) + m.n,
      firstMs: Math.min(cur?.firstMs ?? Infinity, m.f),
      lastMs: Math.max(cur?.lastMs ?? 0, m.l),
    });
  }
  return map;
}

export interface SampleRow {
  id: number;
  value: number | null;
  category: string | null;
  startMs: number;
  endMs: number;
  sourceName: string | null;
  source: string;
}

export function getRecentSamples(db: DB, metricKey: string, range: DateRange, limit = 50): SampleRow[] {
  return db
    .prepare(
      `SELECT id, value, category, start_ms AS startMs, end_ms AS endMs, source_name AS sourceName, source
       FROM health_samples WHERE type = ? AND deleted_at IS NULL AND start_ms >= ? AND start_ms < ?
       ORDER BY start_ms DESC LIMIT ?`,
    )
    .all(metricKey, range.startMs, range.endMs, limit) as SampleRow[];
}

export function getSourceBreakdown(db: DB, metricKey: string, range: DateRange): { sourceName: string; source: string; samples: number }[] {
  return db
    .prepare(
      `SELECT COALESCE(source_name, '(unknown)') AS sourceName, source, COUNT(*) AS samples FROM health_samples
       WHERE type = ? AND deleted_at IS NULL AND start_ms >= ? AND start_ms < ? GROUP BY source_name, source ORDER BY samples DESC`,
    )
    .all(metricKey, range.startMs, range.endMs) as { sourceName: string; source: string; samples: number }[];
}

/** Same as getSourceBreakdown, but across every metric type — for "what synced in this window". */
export function getAllSourcesBreakdown(db: DB, range: DateRange): { sourceName: string; source: string; samples: number }[] {
  return db
    .prepare(
      `SELECT COALESCE(source_name, '(unknown)') AS sourceName, source, COUNT(*) AS samples FROM health_samples
       WHERE deleted_at IS NULL AND start_ms >= ? AND start_ms < ? GROUP BY source_name, source ORDER BY samples DESC`,
    )
    .all(range.startMs, range.endMs) as { sourceName: string; source: string; samples: number }[];
}
