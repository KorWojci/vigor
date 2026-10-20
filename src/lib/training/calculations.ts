/**
 * Training calculations.
 *
 * Estimated 1RM uses the Epley formula, weight × (1 + reps / 30), applied only to working sets
 * with 1–12 reps (estimates degrade quickly above that). A single rep returns the weight itself.
 */
export type ExerciseKind = "weighted" | "bodyweight" | "weighted_bodyweight" | "assisted" | "duration" | "distance";

export const EXERCISE_KINDS: { key: ExerciseKind; label: string; description: string }[] = [
  { key: "weighted", label: "Weighted", description: "External load × reps (barbell, dumbbell, machine)." },
  { key: "bodyweight", label: "Bodyweight", description: "Reps without external load." },
  { key: "weighted_bodyweight", label: "Weighted bodyweight", description: "Bodyweight plus added load (e.g. weighted pull-up). Weight = added load." },
  { key: "assisted", label: "Assisted", description: "Machine/band assistance. Weight = assistance, so lower is better." },
  { key: "duration", label: "Duration", description: "Timed holds or intervals (e.g. plank)." },
  { key: "distance", label: "Distance", description: "Distance-based (e.g. sled push, farmer's walk, rowing)." },
];

export interface SetData {
  setType: string;
  weightKg: number | null;
  reps: number | null;
  distanceM: number | null;
  durationS: number | null;
  rpe?: number | null;
}

export const MAX_E1RM_REPS = 12;

export function estimate1RM(weightKg: number | null, reps: number | null): number | null {
  if (!weightKg || weightKg <= 0 || !reps || reps < 1 || reps > MAX_E1RM_REPS) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function isWorkingSet(s: SetData): boolean {
  return s.setType !== "warmup";
}

export interface SessionStats {
  workingSets: number;
  totalReps: number;
  /** weight × reps over working sets (weighted kinds), kg */
  volumeKg: number;
  maxWeightKg: number | null;
  bestE1RM: number | null;
  /** set giving the best e1RM / heaviest weight / most reps, depending on kind */
  topSet: SetData | null;
  totalDurationS: number;
  totalDistanceM: number;
  /** For assisted exercises: the lightest assistance used. */
  minAssistanceKg: number | null;
}

export function sessionStats(kind: ExerciseKind, sets: SetData[]): SessionStats {
  const working = sets.filter(isWorkingSet);
  const stats: SessionStats = {
    workingSets: working.length,
    totalReps: 0,
    volumeKg: 0,
    maxWeightKg: null,
    bestE1RM: null,
    topSet: null,
    totalDurationS: 0,
    totalDistanceM: 0,
    minAssistanceKg: null,
  };
  let topScore = -Infinity;
  for (const s of working) {
    stats.totalReps += s.reps ?? 0;
    stats.totalDurationS += s.durationS ?? 0;
    stats.totalDistanceM += s.distanceM ?? 0;
    if (s.weightKg !== null && s.weightKg > 0) {
      stats.maxWeightKg = Math.max(stats.maxWeightKg ?? 0, s.weightKg);
      if (kind === "assisted") stats.minAssistanceKg = Math.min(stats.minAssistanceKg ?? Infinity, s.weightKg);
      else stats.volumeKg += s.weightKg * (s.reps ?? 0);
    }
    let score: number;
    switch (kind) {
      case "weighted":
      case "weighted_bodyweight": {
        const e = estimate1RM(s.weightKg, s.reps);
        if (e !== null) stats.bestE1RM = Math.max(stats.bestE1RM ?? 0, e);
        score = e ?? (s.weightKg ?? 0);
        break;
      }
      case "assisted":
        score = (s.reps ?? 0) * 1000 - (s.weightKg ?? 0);
        break;
      case "bodyweight":
        score = s.reps ?? 0;
        break;
      case "duration":
        score = s.durationS ?? 0;
        break;
      case "distance":
        score = s.distanceM ?? 0;
        break;
    }
    if (score > topScore) {
      topScore = score;
      stats.topSet = s;
    }
  }
  return stats;
}

/** Infers an exercise kind from its name and recorded sets. */
export function inferKind(name: string, sets: SetData[]): ExerciseKind {
  const n = name.toLowerCase();
  if (n.includes("assisted")) return "assisted";
  const hasWeight = sets.some((s) => (s.weightKg ?? 0) > 0);
  const hasReps = sets.some((s) => (s.reps ?? 0) > 0);
  const hasDistance = sets.some((s) => (s.distanceM ?? 0) > 0);
  const hasDuration = sets.some((s) => (s.durationS ?? 0) > 0);
  if (hasWeight && hasReps) return n.includes("weighted") ? "weighted_bodyweight" : "weighted";
  if (hasReps) return "bodyweight";
  if (hasDistance) return "distance";
  if (hasDuration) return "duration";
  return hasWeight ? "weighted" : "bodyweight";
}

export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
