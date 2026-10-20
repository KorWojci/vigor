import { type MetricDef, type SleepCategory } from "../metrics/catalog";
import { dayKey, hourKey } from "../time";
import { mergeIntervals, totalLength, type Interval } from "./intervals";

/**
 * Pure aggregation functions. They take raw samples and produce one value per local day.
 * Days without samples are simply absent — callers must render them as "no data", never 0.
 */
export interface RawSample {
  startMs: number;
  endMs: number;
  value: number | null;
  category: string | null;
  sourceName: string | null;
  source: string;
}

export interface DayValue {
  day: string;
  value: number;
  min?: number;
  max?: number;
  count: number;
  sources: string[];
  /** epoch ms of the reading represented (latest metrics) */
  at?: number;
  sourceOfValue?: string;
}

const HOUR_MS = 3600_000;

function srcLabel(s: RawSample): string {
  return s.sourceName || s.source;
}

function groupByDay<T extends RawSample>(samples: T[], tz: string, at: (s: T) => number = (s) => s.startMs): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const s of samples) {
    const k = dayKey(at(s), tz);
    const arr = m.get(k);
    if (arr) arr.push(s);
    else m.set(k, [s]);
  }
  return m;
}

/**
 * Cumulative metrics. With overlap "max-source", per bucket the source with the largest total
 * wins, so an iPhone and an Apple Watch counting the same steps are not added together.
 * Buckets are hours when every sample of that day is ≤ 1 h long (typical HealthKit data), and the
 * whole day otherwise (e.g. a Shortcut that sends one daily total), to avoid mixing granularities.
 */
export function aggregateSum(samples: RawSample[], overlap: "max-source" | "sum-all", tz: string): DayValue[] {
  const out: DayValue[] = [];
  for (const [day, items] of groupByDay(samples, tz)) {
    const sources = [...new Set(items.map(srcLabel))];
    let value = 0;
    if (overlap === "sum-all") {
      value = items.reduce((a, s) => a + (s.value ?? 0), 0);
    } else {
      const hourly = items.every((s) => s.endMs - s.startMs <= HOUR_MS + 60_000);
      const buckets = new Map<string, Map<string, number>>();
      for (const s of items) {
        const b = hourly ? hourKey(s.startMs, tz) : day;
        const perSource = buckets.get(b) ?? new Map<string, number>();
        perSource.set(srcLabel(s), (perSource.get(srcLabel(s)) ?? 0) + (s.value ?? 0));
        buckets.set(b, perSource);
      }
      for (const perSource of buckets.values()) value += Math.max(...perSource.values());
    }
    out.push({ day, value, count: items.length, sources });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Discrete measurements: daily mean, min and max. */
export function aggregateAvg(samples: RawSample[], tz: string): DayValue[] {
  const out: DayValue[] = [];
  for (const [day, items] of groupByDay(samples, tz)) {
    const values = items.map((s) => s.value).filter((v): v is number => v !== null);
    if (!values.length) continue;
    out.push({
      day,
      value: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
      sources: [...new Set(items.map(srcLabel))],
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Slowly changing measurements: the last reading of each day. */
export function aggregateLatest(samples: RawSample[], tz: string): DayValue[] {
  const out: DayValue[] = [];
  for (const [day, items] of groupByDay(samples, tz, (s) => s.endMs)) {
    const withValue = items.filter((s) => s.value !== null);
    if (!withValue.length) continue;
    const last = withValue.reduce((a, b) => (b.endMs >= a.endMs ? b : a));
    out.push({
      day,
      value: last.value!,
      min: Math.min(...withValue.map((s) => s.value!)),
      max: Math.max(...withValue.map((s) => s.value!)),
      count: withValue.length,
      sources: [...new Set(withValue.map(srcLabel))],
      at: last.endMs,
      sourceOfValue: srcLabel(last),
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export interface SleepNight {
  /** The day the night ends on (wake-up day). A "sleep day" runs from 18:00 to 18:00 local time. */
  day: string;
  asleepMin: number;
  inBedMin: number | null;
  awakeMin: number;
  stages: { core: number; deep: number; rem: number; unspecified: number };
  hasStages: boolean;
  startMs: number;
  endMs: number;
  sources: string[];
}

const SLEEP_DAY_SHIFT_MS = 6 * HOUR_MS;
const ASLEEP: SleepCategory[] = ["asleep_core", "asleep_deep", "asleep_rem", "asleep_unspecified"];

/**
 * Sleep: overlapping samples (several apps, or watch + phone) are merged as time intervals,
 * so total sleep is never double counted.
 */
export function aggregateSleep(samples: RawSample[], tz: string): SleepNight[] {
  const out: SleepNight[] = [];
  for (const [day, items] of groupByDay(samples, tz, (s) => s.startMs + SLEEP_DAY_SHIFT_MS)) {
    const by = (cats: string[]): Interval[] => items.filter((s) => cats.includes(s.category ?? "")).map((s) => [s.startMs, s.endMs]);
    const asleep = mergeIntervals(by(ASLEEP));
    const inBed = by(["in_bed"]);
    const minutes = (iv: Interval[]) => totalLength(iv) / 60_000;
    const staged = by(["asleep_core", "asleep_deep", "asleep_rem"]);
    const all = items.map((s) => [s.startMs, s.endMs] as Interval);
    const asleepMin = minutes(asleep);
    if (asleepMin === 0 && inBed.length === 0) continue;
    out.push({
      day,
      asleepMin,
      inBedMin: inBed.length ? minutes(inBed) : null,
      awakeMin: minutes(by(["awake"])),
      stages: {
        core: minutes(by(["asleep_core"])),
        deep: minutes(by(["asleep_deep"])),
        rem: minutes(by(["asleep_rem"])),
        unspecified: staged.length ? 0 : minutes(by(["asleep_unspecified"])),
      },
      hasStages: staged.length > 0,
      startMs: Math.min(...all.map((i) => i[0])),
      endMs: Math.max(...all.map((i) => i[1])),
      sources: [...new Set(items.map(srcLabel))],
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export function aggregateDaily(def: MetricDef, samples: RawSample[], tz: string): DayValue[] {
  switch (def.aggregation) {
    case "sum":
      return aggregateSum(samples, def.overlap ?? "max-source", tz);
    case "avg":
      return aggregateAvg(samples, tz);
    case "latest":
      return aggregateLatest(samples, tz);
    case "sleep":
      return aggregateSleep(samples, tz).map((n) => ({ day: n.day, value: n.asleepMin, count: 1, sources: n.sources }));
  }
}
