/**
 * Groups ExerciseDB's muscle vocabulary (GET /api/v1/muscles, 38 names) into a smaller set of
 * body zones for the "muscles trained" figure. The grouping is editorial (Vigor's own), not a
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

export type ZoneLoad = Partial<Record<MuscleZone, number>>;

export interface WorkoutExerciseMuscles {
  workingSets: number;
  targetMuscles: string[];
  secondaryMuscles: string[];
}

/**
 * Adds one strength exercise's contribution to a raw (unnormalised) load accumulator. A target
 * muscle counts double a secondary one; both are weighted by working sets so high-volume
 * exercises stand out more. Mutates `raw` so callers can accumulate across many exercises and
 * workouts before normalising once at the end.
 */
export function addExerciseLoad(raw: ZoneLoad, ex: WorkoutExerciseMuscles): void {
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

/**
 * Non-strength activities (a run, a walk, a yoga session, etc.) have no logged sets or target
 * muscles, so there's nothing real to read — this is an explicit assumption from the activity
 * type and duration, not a measurement, and must be labelled as such wherever it's shown.
 * `durationS` is capped at 3h so one very long activity can't swamp everything else in a day.
 * Weights are per hour and roughly comparable to one exercise's working-set contribution above;
 * they are not derived from any source, just a reasonable guess at relative muscle involvement.
 */
const ACTIVITY_LOAD_PER_HOUR: { test: RegExp; zones: ZoneLoad }[] = [
  { test: /run|jog|treadmill/i, zones: { quadriceps: 3, hamstrings: 3, calves: 3, glutes: 2, hip_flexors: 1.5, abs: 1 } },
  { test: /walk|hik/i, zones: { quadriceps: 1.5, hamstrings: 1, calves: 2, glutes: 1 } },
  { test: /cycl|bik|spin/i, zones: { quadriceps: 3, calves: 2, glutes: 1.5, hamstrings: 1 } },
  { test: /swim/i, zones: { shoulders: 3, lats: 2.5, triceps: 1.5, chest: 1, abs: 1, calves: 1 } },
  { test: /yoga|pilates|stretch|flexib/i, zones: { abs: 1.5, obliques: 1.2, lower_back: 1.2, hip_flexors: 1, shoulders: 1 } },
  { test: /row(ing)?|erg\b/i, zones: { lats: 3, upper_back: 2.5, biceps: 1.5, quadriceps: 1.8, hamstrings: 1.2 } },
  { test: /elliptical|stair|step\b/i, zones: { quadriceps: 2.5, calves: 2, glutes: 1.8, hamstrings: 1.2 } },
  { test: /hiit|interval|circuit|cross.?training|bootcamp/i, zones: { quadriceps: 2, abs: 1.5, shoulders: 1.2, calves: 1.5, glutes: 1.2 } },
  { test: /core|\babs?\b/i, zones: { abs: 3, obliques: 2.5, lower_back: 1.2 } },
  { test: /dance/i, zones: { quadriceps: 1.5, calves: 1.8, hip_flexors: 1.2, abs: 1 } },
  { test: /box(ing)?|martial|kickbox/i, zones: { shoulders: 2, abs: 1.8, obliques: 1.5, quadriceps: 1.5, calves: 1.2 } },
];

/** True if `activityType` matches one of the activities above — i.e. any load for it would be assumed, not measured. */
export function isAssumedActivity(activityType: string): boolean {
  return ACTIVITY_LOAD_PER_HOUR.some((e) => e.test.test(activityType));
}

export function addActivityLoad(raw: ZoneLoad, activityType: string, durationS: number): void {
  const hours = Math.min(3, durationS / 3600);
  if (hours <= 0) return;
  const entry = ACTIVITY_LOAD_PER_HOUR.find((e) => e.test.test(activityType));
  if (!entry) return;
  for (const [zone, w] of Object.entries(entry.zones)) raw[zone as MuscleZone] = (raw[zone as MuscleZone] ?? 0) + w! * hours;
}

/** Normalises a raw load accumulator so the most-worked zone is 1. Zones with no involvement are omitted (never rendered as a fabricated zero). */
export function normalizeLoad(raw: ZoneLoad): ZoneLoad {
  const max = Math.max(0, ...Object.values(raw));
  if (max === 0) return {};
  const out: ZoneLoad = {};
  for (const [zone, v] of Object.entries(raw)) out[zone as MuscleZone] = v! / max;
  return out;
}
