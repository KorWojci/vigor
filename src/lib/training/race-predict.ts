/**
 * Race-time prediction from logged running workouts. Pure math — src/app/(app)/training/page.tsx
 * supplies the qualifying runs (see `listRunningEfforts` in repo.ts).
 */
export interface RunEffort {
  workoutId: number;
  distanceM: number;
  durationS: number;
  startMs: number;
}

export interface RaceDistance {
  key: string;
  label: string;
  meters: number;
}

export const RACE_DISTANCES: RaceDistance[] = [
  { key: "5k", label: "5K", meters: 5000 },
  { key: "10k", label: "10K", meters: 10000 },
  { key: "half", label: "Half marathon", meters: 21097.5 },
  { key: "marathon", label: "Marathon", meters: 42195 },
];

/** Riegel's formula (T2 = T1 × (D2/D1)^k): the standard fatigue-factor exponent for predicting a race time at one distance from a performance at another. */
const RIEGEL_EXPONENT = 1.06;

export function riegelPredict(knownDistanceM: number, knownDurationS: number, targetDistanceM: number): number {
  return knownDurationS * (targetDistanceM / knownDistanceM) ** RIEGEL_EXPONENT;
}

/** Runs shorter than this are too noisy (warm-ups, short treadmill tests) to extrapolate a race pace from. */
export const MIN_EFFORT_M = 1000;

export type Confidence = "high" | "medium" | "low";

/** How far the source run's distance is from the target — a marathon time extrapolated from a 5K is a much bigger guess than one from a half marathon. */
function confidenceFor(sourceDistanceM: number, targetDistanceM: number): Confidence {
  const ratio = Math.max(sourceDistanceM, targetDistanceM) / Math.min(sourceDistanceM, targetDistanceM);
  if (ratio <= 1.5) return "high";
  if (ratio <= 3) return "medium";
  return "low";
}

export interface RacePrediction {
  distance: RaceDistance;
  predictedS: number | null;
  basedOn: RunEffort | null;
  confidence: Confidence | null;
}

/**
 * Predicts a time for each standard race distance from whichever qualifying run implies the
 * fastest (most optimistic) time via Riegel's formula — your best demonstrated fitness, not an
 * average of everything. Distances with no qualifying runs get a null prediction rather than a
 * guess.
 */
export function predictRaceTimes(efforts: RunEffort[]): RacePrediction[] {
  const qualifying = efforts.filter((e) => e.distanceM >= MIN_EFFORT_M && e.durationS > 0);
  return RACE_DISTANCES.map((distance) => {
    let best: { effort: RunEffort; predictedS: number } | null = null;
    for (const effort of qualifying) {
      const predictedS = riegelPredict(effort.distanceM, effort.durationS, distance.meters);
      if (!best || predictedS < best.predictedS) best = { effort, predictedS };
    }
    return best
      ? { distance, predictedS: best.predictedS, basedOn: best.effort, confidence: confidenceFor(best.effort.distanceM, distance.meters) }
      : { distance, predictedS: null, basedOn: null, confidence: null };
  });
}
