import type { DB } from "../db";

/**
 * Workout detail derived from the raw Apple Health samples recorded during a workout (heart rate,
 * distance, active energy). HealthKit workouts only carry a summary; the samples are already in
 * `health_samples`, so nothing extra has to be synced.
 *
 * Several devices often record the same thing at the same time (watch + iPhone distance, watch +
 * chest strap heart rate). Per metric only the source with the most data in the window is used, so
 * nothing is counted twice.
 */
export interface WindowSample {
  type: string;
  startMs: number;
  endMs: number;
  value: number;
  sourceName: string | null;
}

export interface HrPoint {
  min: number; // minutes since workout start
  bpm: number;
}

export interface HrZone {
  zone: number; // 1–5
  label: string;
  fromBpm: number;
  toBpm: number | null; // null = open-ended
  seconds: number;
}

export interface Split {
  index: number; // 1-based
  distanceM: number; // length of this split (the last one may be partial)
  durationS: number;
  avgHr: number | null;
  energyKcal: number | null;
}

export interface CardioDetail {
  hrSource: string | null;
  distanceSource: string | null;
  hr: HrPoint[];
  hrAvg: number | null;
  hrMax: number | null;
  zones: HrZone[] | null;
  splits: Split[];
  splitLengthM: number;
  energyPerMinute: { min: number; kcal: number }[];
}

const HR_TYPES = ["heart_rate"];
const DISTANCE_TYPES = ["distance_walking_running"];
const ENERGY_TYPES = ["active_energy"];
/** A gap longer than this between heart-rate readings is not credited to any zone. */
const MAX_HR_GAP_S = 60;
const MAX_HR_POINTS = 400;

/** Zone bounds as % of max HR (the common 5-zone model). */
const ZONE_PCT = [50, 60, 70, 80, 90];
const ZONE_LABELS = ["Very light", "Light", "Moderate", "Hard", "Maximum"];

export function workoutWindowSamples(db: DB, startMs: number, endMs: number): WindowSample[] {
  const types = [...HR_TYPES, ...DISTANCE_TYPES, ...ENERGY_TYPES];
  return db
    .prepare(
      `SELECT type, start_ms AS startMs, end_ms AS endMs, value, source_name AS sourceName FROM health_samples
       WHERE deleted_at IS NULL AND value IS NOT NULL AND type IN (${types.map(() => "?").join(",")})
         AND start_ms >= ? AND start_ms < ? ORDER BY start_ms`,
    )
    .all(...types, startMs, endMs) as WindowSample[];
}

/** The source with the most samples (or the largest total, when `byValue`) — used alone to avoid double counting. */
export function primarySource(samples: WindowSample[], byValue = false): string | null {
  const score = new Map<string | null, number>();
  for (const s of samples) score.set(s.sourceName, (score.get(s.sourceName) ?? 0) + (byValue ? s.value : 1));
  let best: string | null = null;
  let bestScore = 0;
  for (const [k, v] of score) if (v > bestScore) [best, bestScore] = [k, v];
  return best;
}

/** Averages readings into at most `maxPoints` buckets for charting. */
export function downsampleHr(readings: { t: number; bpm: number }[], startMs: number, endMs: number, maxPoints = MAX_HR_POINTS): HrPoint[] {
  if (readings.length <= maxPoints) return readings.map((r) => ({ min: (r.t - startMs) / 60_000, bpm: r.bpm }));
  const bucketMs = Math.max(1, (endMs - startMs) / maxPoints);
  const buckets = new Map<number, { sum: number; n: number; t: number }>();
  for (const r of readings) {
    const k = Math.floor((r.t - startMs) / bucketMs);
    const b = buckets.get(k) ?? { sum: 0, n: 0, t: 0 };
    b.sum += r.bpm;
    b.t += r.t;
    b.n += 1;
    buckets.set(k, b);
  }
  return [...buckets.values()].map((b) => ({ min: (b.t / b.n - startMs) / 60_000, bpm: b.sum / b.n }));
}

/**
 * Time in each heart-rate zone. Each reading counts until the next one (capped at MAX_HR_GAP_S);
 * the last reading counts for the median interval. Readings below zone 1 are counted in zone 1.
 */
export function hrZones(readings: { t: number; bpm: number }[], maxHr: number, endMs: number): HrZone[] {
  const bounds = ZONE_PCT.map((p) => Math.round((maxHr * p) / 100));
  const zones: HrZone[] = bounds.map((from, i) => ({ zone: i + 1, label: ZONE_LABELS[i], fromBpm: from, toBpm: bounds[i + 1] ?? null, seconds: 0 }));
  if (readings.length === 0) return zones;
  const gaps = readings.slice(1).map((r, i) => (r.t - readings[i].t) / 1000).sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 5;
  readings.forEach((r, i) => {
    const next = readings[i + 1]?.t ?? Math.min(endMs, r.t + typical * 1000);
    const secs = Math.min(MAX_HR_GAP_S, Math.max(0, (next - r.t) / 1000));
    let z = 0;
    for (let k = bounds.length - 1; k >= 0; k--) if (r.bpm >= bounds[k]) { z = k; break; }
    zones[z].seconds += secs;
  });
  return zones;
}

/**
 * Splits of `splitM` metres from cumulative distance samples. A sample's distance is spread evenly
 * over its own duration, so a split boundary inside a sample is interpolated. The final partial
 * split is kept when it is at least 10% of a full split.
 */
export function distanceSplits(
  distance: WindowSample[],
  startMs: number,
  splitM: number,
  hr: { t: number; bpm: number }[] = [],
  energy: WindowSample[] = [],
): Split[] {
  const boundaries: { t: number; d: number }[] = [{ t: startMs, d: 0 }];
  let cum = 0;
  let next = splitM;
  for (const s of distance) {
    const dur = Math.max(1, s.endMs - s.startMs);
    while (cum + s.value >= next) {
      boundaries.push({ t: s.startMs + ((next - cum) / s.value) * dur, d: next });
      next += splitM;
    }
    cum += s.value;
  }
  const last = distance[distance.length - 1];
  if (last && cum - boundaries[boundaries.length - 1].d >= splitM * 0.1) boundaries.push({ t: last.endMs, d: cum });
  const splits: Split[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i - 1];
    const b = boundaries[i];
    const inHr = hr.filter((r) => r.t >= a.t && r.t < b.t);
    const inEnergy = energy.filter((e) => e.startMs >= a.t && e.startMs < b.t);
    splits.push({
      index: i,
      distanceM: b.d - a.d,
      durationS: (b.t - a.t) / 1000,
      avgHr: inHr.length ? inHr.reduce((x, r) => x + r.bpm, 0) / inHr.length : null,
      energyKcal: inEnergy.length ? inEnergy.reduce((x, e) => x + e.value, 0) : null,
    });
  }
  return splits;
}

export function energyPerMinute(energy: WindowSample[], startMs: number, endMs: number): { min: number; kcal: number }[] {
  const minutes = Math.max(1, Math.ceil((endMs - startMs) / 60_000));
  const out = Array.from({ length: minutes }, (_, i) => ({ min: i, kcal: 0 }));
  for (const e of energy) {
    const i = Math.floor((e.startMs - startMs) / 60_000);
    if (i >= 0 && i < minutes) out[i].kcal += e.value;
  }
  return out;
}

/** The source whose total is closest to the distance the workout itself reports. */
function sourceClosestTo(samples: WindowSample[], target: number): string | null {
  const totals = new Map<string | null, number>();
  for (const s of samples) totals.set(s.sourceName, (totals.get(s.sourceName) ?? 0) + s.value);
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const [k, v] of totals) if (Math.abs(v - target) < bestDiff) [best, bestDiff] = [k, Math.abs(v - target)];
  return best;
}

/**
 * `distanceM` is the workout's own distance: splits are only built when it has one (a strength
 * workout has walking distance samples too, but no splits), from the source that matches it best.
 */
export function cardioDetail(
  samples: WindowSample[],
  startMs: number,
  endMs: number,
  opts: { maxHr: number | null; splitM: number; distanceM: number | null },
): CardioDetail {
  const of = (types: string[]) => samples.filter((s) => types.includes(s.type));
  const hrAll = of(HR_TYPES);
  const hrSource = primarySource(hrAll);
  const hr = hrAll.filter((s) => s.sourceName === hrSource).map((s) => ({ t: s.startMs, bpm: s.value }));
  const distAll = of(DISTANCE_TYPES);
  const distanceSource = opts.distanceM ? sourceClosestTo(distAll, opts.distanceM) : null;
  const distance = distAll.filter((s) => s.sourceName === distanceSource);
  const energyAll = of(ENERGY_TYPES);
  const energySource = primarySource(energyAll, true);
  const energy = energyAll.filter((s) => s.sourceName === energySource);
  return {
    hrSource,
    distanceSource,
    hr: downsampleHr(hr, startMs, endMs),
    hrAvg: hr.length ? hr.reduce((a, r) => a + r.bpm, 0) / hr.length : null,
    hrMax: hr.length ? Math.max(...hr.map((r) => r.bpm)) : null,
    zones: opts.maxHr && hr.length ? hrZones(hr, opts.maxHr, endMs) : null,
    splits: distanceSource !== null && distance.length ? distanceSplits(distance, startMs, opts.splitM, hr, energy) : [],
    splitLengthM: opts.splitM,
    energyPerMinute: energy.length ? energyPerMinute(energy, startMs, endMs) : [],
  };
}

/**
 * Max heart rate for zones: the profile value, else 220 − age, else the highest reading of the
 * last 12 months. `basis` says which one was used, so the UI can label it.
 */
export function maxHeartRate(db: DB, profile: { maxHeartRate?: number; birthYear?: number }, now = Date.now()): { bpm: number; basis: "profile" | "age" | "observed" } | null {
  if (profile.maxHeartRate) return { bpm: profile.maxHeartRate, basis: "profile" };
  if (profile.birthYear) return { bpm: 220 - (new Date(now).getUTCFullYear() - profile.birthYear), basis: "age" };
  const row = db
    .prepare("SELECT MAX(value) AS m FROM health_samples WHERE type = 'heart_rate' AND deleted_at IS NULL AND start_ms >= ?")
    .get(now - 365 * 86_400_000) as { m: number | null };
  return row.m ? { bpm: Math.round(row.m), basis: "observed" } : null;
}
