import type { DB } from "./db";
import { importHealthPayload } from "./ingest/health-import";
import { addMeasurement } from "./body/repo";
import { getSetting } from "./settings";
import { importHevyCsv } from "./training/hevy-import";
import { addDays, dayKey, startOfDayMs } from "./time";

/**
 * SYNTHETIC demonstration data generator. Produces plausible but entirely invented values so the
 * UI can be explored without real health data. All samples use source "demo" and every manual
 * measurement carries the note "SYNTHETIC demo data".
 */
export const DEMO_SOURCE = "demo";
const DEMO_NOTE = "SYNTHETIC demo data";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function seedDemoData(db: DB, opts: { days?: number; hevyCsv?: string; now?: number } = {}) {
  const days = opts.days ?? 90;
  const tz = getSetting(db, "timezone");
  const rand = rng(42);
  const noise = (scale: number) => (rand() - 0.5) * 2 * scale;
  const now = opts.now ?? Date.now();
  const today = dayKey(now, tz);
  const iso = (ms: number) => new Date(ms).toISOString();
  type S = Record<string, unknown>;
  const samples: S[] = [];
  const workouts: S[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const d0 = startOfDayMs(day, tz);
    const progress = (days - i) / days;
    // Activity: hourly step & energy samples between 07:00 and 21:00 from a synthetic watch.
    for (let h = 7; h <= 21; h++) {
      const start = d0 + h * 3600_000;
      if (start + 3600_000 > now) break;
      const active = h === 7 || h === 12 || h === 18 ? 2.2 : 1;
      samples.push({ type: "step_count", value: Math.max(0, Math.round((500 + noise(300)) * active)), unit: "count", startAt: iso(start), endAt: iso(start + 3600_000), sourceName: "Demo Watch" });
      samples.push({ type: "active_energy", value: Math.max(0, Math.round((28 + noise(12)) * active)), unit: "kcal", startAt: iso(start), endAt: iso(start + 3600_000), sourceName: "Demo Watch" });
      samples.push({ type: "distance_walking_running", value: Math.max(0, (0.38 + noise(0.2)) * active), unit: "km", startAt: iso(start), endAt: iso(start + 3600_000), sourceName: "Demo Watch" });
      if (h % 3 === 0) samples.push({ type: "heart_rate", value: Math.round(72 + noise(14) + (active > 1 ? 25 : 0)), unit: "count/min", startAt: iso(start + 600_000), sourceName: "Demo Watch" });
      if (h % 2 === 0) samples.push({ type: "stand_hours", value: 1, unit: "hr", startAt: iso(start), endAt: iso(start + 3600_000), sourceName: "Demo Watch" });
    }
    if (d0 + 22 * 3600_000 > now) continue;
    samples.push({ type: "basal_energy", value: Math.round(1720 + noise(40)), unit: "kcal", startAt: iso(d0), endAt: iso(d0 + 86_400_000 - 60_000), sourceName: "Demo Watch" });
    samples.push({ type: "exercise_time", value: Math.round(28 + noise(20)), unit: "min", startAt: iso(d0 + 18 * 3600_000), endAt: iso(d0 + 19 * 3600_000), sourceName: "Demo Watch" });
    samples.push({ type: "flights_climbed", value: Math.round(8 + noise(6)), unit: "count", startAt: iso(d0 + 12 * 3600_000), endAt: iso(d0 + 13 * 3600_000), sourceName: "Demo Watch" });
    samples.push({ type: "resting_heart_rate", value: Math.round(60 - progress * 4 + noise(2.5)), unit: "count/min", startAt: iso(d0 + 8 * 3600_000), sourceName: "Demo Watch" });
    samples.push({ type: "heart_rate_variability", value: Math.round(48 + progress * 8 + noise(9)), unit: "ms", startAt: iso(d0 + 3 * 3600_000), sourceName: "Demo Watch" });
    samples.push({ type: "oxygen_saturation", value: 0.965 + noise(0.012), unit: "fraction", startAt: iso(d0 + 4 * 3600_000), sourceName: "Demo Watch" });
    samples.push({ type: "respiratory_rate", value: 14.5 + noise(1.2), unit: "count/min", startAt: iso(d0 + 4 * 3600_000), sourceName: "Demo Watch" });
    if (i % 7 === 0) samples.push({ type: "vo2_max", value: 44 + progress * 2.5 + noise(0.6), unit: "ml/(kg·min)", startAt: iso(d0 + 18 * 3600_000), sourceName: "Demo Watch" });
    if (i % 2 === 0) {
      samples.push({ type: "body_mass", value: 84 - progress * 3 + noise(0.4), unit: "kg", startAt: iso(d0 + 7 * 3600_000), sourceName: "Demo Scale" });
      samples.push({ type: "body_fat_percentage", value: 0.2 - progress * 0.02 + noise(0.004), unit: "fraction", startAt: iso(d0 + 7 * 3600_000), sourceName: "Demo Scale" });
    }
    // Nutrition (logged most days, not all — missing days must show as missing).
    if (rand() > 0.15) {
      for (const [h, share] of [[8, 0.25], [13, 0.4], [19, 0.35]] as const) {
        const t = iso(d0 + h * 3600_000);
        const kcal = (2350 + noise(300)) * share;
        samples.push({ type: "dietary_energy", value: Math.round(kcal), unit: "kcal", startAt: t, sourceName: "Demo Food Log" });
        samples.push({ type: "dietary_protein", value: Math.round((kcal * 0.27) / 4), unit: "g", startAt: t, sourceName: "Demo Food Log" });
        samples.push({ type: "dietary_carbohydrates", value: Math.round((kcal * 0.45) / 4), unit: "g", startAt: t, sourceName: "Demo Food Log" });
        samples.push({ type: "dietary_fat", value: Math.round((kcal * 0.28) / 9), unit: "g", startAt: t, sourceName: "Demo Food Log" });
      }
      samples.push({ type: "dietary_water", value: Math.round(2100 + noise(500)), unit: "mL", startAt: iso(d0 + 20 * 3600_000), sourceName: "Demo Food Log" });
    }
    // Sleep for the night ending on `day`, with stages.
    let t = d0 - 60 * 60_000 + noise(30) * 60_000; // ~23:00 previous evening
    const bedStart = t - 10 * 60_000;
    const cycles = 5;
    for (let c = 0; c < cycles; c++) {
      for (const [cat, mins] of [["asleep_core", 32], ["asleep_deep", c < 2 ? 24 : 8], ["asleep_core", 18], ["asleep_rem", 12 + c * 4]] as const) {
        const len = Math.max(5, mins + noise(6)) * 60_000;
        samples.push({ type: "sleep_analysis", category: cat, startAt: iso(t), endAt: iso(t + len), sourceName: "Demo Watch" });
        t += len;
      }
      if (c === 2) {
        samples.push({ type: "sleep_analysis", category: "awake", startAt: iso(t), endAt: iso(t + 6 * 60_000), sourceName: "Demo Watch" });
        t += 6 * 60_000;
      }
    }
    samples.push({ type: "sleep_analysis", category: "in_bed", startAt: iso(bedStart), endAt: iso(t + 8 * 60_000), sourceName: "Demo Phone" });
    if (i % 3 === 1) {
      workouts.push({ activityType: "running", title: "Easy run (demo)", startAt: iso(d0 + 7 * 3600_000), endAt: iso(d0 + 7 * 3600_000 + 32 * 60_000), energyKcal: 330 + noise(40), distanceMeters: 5200 + noise(600), avgHeartRate: 146 + noise(6), sourceName: "Demo Watch" });
    }
  }

  const summary = { samples: 0, workouts: 0, measurements: 0, hevyWorkouts: 0 };
  for (let i = 0; i < samples.length; i += 5000) {
    const body = { schemaVersion: 1, source: DEMO_SOURCE, syncId: `demo-${i}`, generatedAt: new Date(now).toISOString(), samples: samples.slice(i, i + 5000), workouts: i === 0 ? workouts : [] };
    const r = importHealthPayload(db, body, { rawBody: JSON.stringify(body), now });
    summary.samples += r.summary.accepted + r.summary.updated;
  }
  summary.workouts = workouts.length;

  const has = db.prepare("SELECT 1 FROM body_measurements WHERE note = ? LIMIT 1").get(DEMO_NOTE);
  if (!has) {
    const m: [string, number, number][] = [
      ["waist", 88, -3], ["hips", 99, -1.5], ["chest", 102, 1], ["neck", 39, 0], ["shoulders", 121, 1.5],
      ["upper_arm_left", 35.5, 1], ["upper_arm_right", 36, 1], ["forearm_left", 29.5, 0.4], ["forearm_right", 30, 0.4],
      ["thigh_left", 58, 0.5], ["thigh_right", 58.5, 0.5], ["calf_left", 38, 0.2], ["calf_right", 38.2, 0.2], ["height", 180, 0],
    ];
    for (const [key, base, change] of m) {
      for (let k = 0; k < 4; k++) {
        const at = startOfDayMs(addDays(today, -Math.round((days - 1) * (1 - k / 3))), tz) + 8 * 3600_000;
        addMeasurement(db, key, base + (change * k) / 3 + noise(0.2), Math.min(at, now - 3600_000), DEMO_NOTE);
        summary.measurements++;
      }
    }
  }
  if (opts.hevyCsv) summary.hevyWorkouts = importHevyCsv(db, opts.hevyCsv, { tz, fileName: "hevy-workouts-synthetic.csv" }).workouts;
  return summary;
}

export function removeDemoData(db: DB) {
  return db.transaction(() => ({
    samples: db.prepare("DELETE FROM health_samples WHERE source = ?").run(DEMO_SOURCE).changes,
    workouts: db.prepare("DELETE FROM workouts WHERE source = ? OR title LIKE '%(SYNTHETIC)%'").run(DEMO_SOURCE).changes,
    measurements: db.prepare("DELETE FROM body_measurements WHERE note = ?").run(DEMO_NOTE).changes,
    exercises: db.prepare("DELETE FROM exercises WHERE id NOT IN (SELECT exercise_id FROM workout_exercises)").run().changes,
    importRuns: db.prepare("DELETE FROM import_runs WHERE source = ? OR sync_id = 'hevy-workouts-synthetic.csv'").run(DEMO_SOURCE).changes,
  }))();
}
