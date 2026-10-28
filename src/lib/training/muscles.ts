/**
 * Groups ExerciseDB's muscle vocabulary (GET /api/v1/muscles, 38 names) into a smaller set of
 * body zones for the "muscles trained" diagram. The grouping is editorial (Vigor's own), not a
 * copy of any particular anatomy chart.
 */
export type MuscleZone =
  | "neck"
  | "shoulders"
  | "chest"
  | "lats"
  | "upper_back"
  | "lower_back"
  | "abs"
  | "obliques"
  | "biceps"
  | "triceps"
  | "forearms"
  | "glutes"
  | "hip_flexors"
  | "quadriceps"
  | "hamstrings"
  | "adductors"
  | "calves";

export const MUSCLE_ZONE_LABEL: Record<MuscleZone, string> = {
  neck: "Neck",
  shoulders: "Shoulders",
  chest: "Chest",
  lats: "Lats",
  upper_back: "Upper back",
  lower_back: "Lower back",
  abs: "Abs",
  obliques: "Obliques",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  glutes: "Glutes",
  hip_flexors: "Hip flexors",
  quadriceps: "Quadriceps",
  hamstrings: "Hamstrings",
  adductors: "Inner/outer thigh",
  calves: "Calves",
};

/** "cardiovascular system" has no entry: it isn't a drawable muscle zone. */
const ZONE_BY_MUSCLE: Record<string, MuscleZone | undefined> = {
  sternocleidomastoid: "neck",
  "levator scapulae": "neck",
  trapezius: "shoulders",
  deltoids: "shoulders",
  "rear deltoids": "shoulders",
  "rotator cuff": "shoulders",
  pectorals: "chest",
  "serratus anterior": "chest",
  "latissimus dorsi": "lats",
  rhomboids: "upper_back",
  "upper back": "upper_back",
  back: "upper_back",
  "erector spinae": "lower_back",
  abdominals: "abs",
  core: "abs",
  obliques: "obliques",
  "hip flexors": "hip_flexors",
  biceps: "biceps",
  brachialis: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  "wrist flexors": "forearms",
  "wrist extensors": "forearms",
  "grip muscles": "forearms",
  hands: "forearms",
  wrists: "forearms",
  glutes: "glutes",
  quadriceps: "quadriceps",
  hamstrings: "hamstrings",
  adductors: "adductors",
  abductors: "adductors",
  calves: "calves",
  soleus: "calves",
  "tibialis anterior": "calves",
  ankles: "calves",
  "ankle stabilizers": "calves",
  feet: "calves",
};

export function zoneForMuscle(muscle: string): MuscleZone | undefined {
  return ZONE_BY_MUSCLE[muscle.toLowerCase()];
}

export interface WorkoutExerciseMuscles {
  workingSets: number;
  targetMuscles: string[];
  secondaryMuscles: string[];
}

/**
 * Zone -> training intensity for one workout, normalised so the most-worked zone is 1. A target
 * muscle counts double a secondary one; both are weighted by working sets so high-volume exercises
 * stand out more. Zones with no involvement are omitted (never rendered as a fabricated zero).
 */
export function musclesTrained(exercises: WorkoutExerciseMuscles[]): Partial<Record<MuscleZone, number>> {
  const raw: Partial<Record<MuscleZone, number>> = {};
  for (const ex of exercises) {
    const sets = Math.max(1, ex.workingSets);
    for (const m of ex.targetMuscles) {
      const zone = zoneForMuscle(m);
      if (zone) raw[zone] = (raw[zone] ?? 0) + sets;
    }
    for (const m of ex.secondaryMuscles) {
      const zone = zoneForMuscle(m);
      if (zone) raw[zone] = (raw[zone] ?? 0) + sets * 0.5;
    }
  }
  const max = Math.max(0, ...Object.values(raw));
  if (max === 0) return {};
  const out: Partial<Record<MuscleZone, number>> = {};
  for (const [zone, v] of Object.entries(raw)) out[zone as MuscleZone] = v! / max;
  return out;
}
