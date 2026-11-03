import type { Settings } from "../settings";

/**
 * Calorie-need and weight-goal planning. Pure, framework-free math — see
 * src/app/(app)/calorie-goal/page.tsx for where the inputs (measured energy averages, profile,
 * latest weight) come from.
 *
 * TDEE prefers measured data (Apple Health active/resting energy, already deduplicated by
 * src/lib/aggregation) over the Mifflin-St Jeor formula, which is only a fallback when there
 * isn't enough synced history — consistent with "never fabricate data" elsewhere in Vigor.
 */

/** A measured daily average (energy, steps, exercise minutes) is trusted only with this many days of history behind it. */
export const MIN_DAYS_FOR_MEASURED = 7;

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export const ACTIVITY_LEVELS: { key: ActivityLevel; label: string; multiplier: number }[] = [
  { key: "sedentary", label: "Sedentary — little or no exercise", multiplier: 1.2 },
  { key: "light", label: "Lightly active — light exercise 1–3 days/week", multiplier: 1.375 },
  { key: "moderate", label: "Moderately active — moderate exercise 3–5 days/week", multiplier: 1.55 },
  { key: "active", label: "Active — hard exercise 6–7 days/week", multiplier: 1.725 },
  { key: "very_active", label: "Very active — hard daily exercise and a physical job", multiplier: 1.9 },
];

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = Object.fromEntries(
  ACTIVITY_LEVELS.map((l) => [l.key, l.multiplier]),
) as Record<ActivityLevel, number>;

function levelRank(level: ActivityLevel): number {
  return ACTIVITY_LEVELS.findIndex((l) => l.key === level);
}

function levelFromSteps(avgStepsPerDay: number): ActivityLevel {
  if (avgStepsPerDay >= 12500) return "very_active";
  if (avgStepsPerDay >= 10000) return "active";
  if (avgStepsPerDay >= 7500) return "moderate";
  if (avgStepsPerDay >= 5000) return "light";
  return "sedentary";
}

function levelFromExerciseMinutes(avgMinPerWeek: number): ActivityLevel {
  if (avgMinPerWeek >= 450) return "very_active";
  if (avgMinPerWeek >= 300) return "active";
  if (avgMinPerWeek >= 150) return "moderate";
  if (avgMinPerWeek >= 30) return "light";
  return "sedentary";
}

export interface ActivitySignals {
  /** Mean daily steps over a recent window — null if there isn't enough synced history. */
  avgStepsPerDay: number | null;
  /** Mean weekly exercise minutes over the same window — null if there isn't enough history. */
  avgExerciseMinPerWeek: number | null;
}

/**
 * Estimates a PAL-style activity level from recently recorded steps and/or exercise minutes,
 * instead of a subjective self-assessment (people reliably overestimate their own activity
 * level). Rough bands, not a clinical measure. Takes the more active of the two signals when both
 * are present — a desk job with a heavy lifting habit, and a very walkable day with no formal
 * "exercise", are both genuine activity even though only one signal shows it. Returns null when
 * neither has enough data, rather than guessing.
 */
export function classifyActivityLevel({ avgStepsPerDay, avgExerciseMinPerWeek }: ActivitySignals): ActivityLevel | null {
  const levels = [
    avgStepsPerDay != null ? levelFromSteps(avgStepsPerDay) : null,
    avgExerciseMinPerWeek != null ? levelFromExerciseMinutes(avgExerciseMinPerWeek) : null,
  ].filter((l): l is ActivityLevel => l != null);
  if (levels.length === 0) return null;
  return levels.reduce((best, l) => (levelRank(l) > levelRank(best) ? l : best));
}

/** kcal per kg of body-weight change — the standard planning approximation (≈ 3500 kcal/lb). */
export const KCAL_PER_KG = 7700;

/** Absolute floor used only when no personalised BMR can be computed (missing height/age/sex). */
const ABSOLUTE_MIN_KCAL = { male: 1500, female: 1200, fallback: 1200 } as const;

export interface BmrInput {
  weightKg: number;
  heightCm: number | null;
  age: number | null;
  sex: Settings["profile"]["sex"];
}

/**
 * Mifflin-St Jeor BMR. Returns null when height or age aren't known, or sex is "other"/
 * "unspecified" — the equation's offset is sex-specific, so guessing one would misrepresent it
 * as a measurement rather than an estimate.
 */
export function mifflinStJeorBmr({ weightKg, heightCm, age, sex }: BmrInput): number | null {
  if (heightCm == null || age == null || (sex !== "male" && sex !== "female")) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

export interface TdeeInput extends BmrInput {
  activityLevel: ActivityLevel;
  /** Average measured kcal/day over a recent window (src/lib/aggregation), or null if too little data. */
  measuredBasalKcal: number | null;
  measuredActiveKcal: number | null;
}

export interface TdeeResult {
  tdeeKcal: number | null;
  bmrKcal: number | null;
  basalKcal: number | null;
  basalSource: "measured" | "formula" | null;
  activeKcal: number | null;
  activeSource: "measured" | "formula" | null;
}

export function estimateTdee(input: TdeeInput): TdeeResult {
  const bmrKcal = mifflinStJeorBmr(input);

  const basalKcal = input.measuredBasalKcal ?? bmrKcal;
  const basalSource: TdeeResult["basalSource"] = input.measuredBasalKcal != null ? "measured" : bmrKcal != null ? "formula" : null;

  let activeKcal: number | null;
  let activeSource: TdeeResult["activeSource"];
  if (input.measuredActiveKcal != null) {
    activeKcal = input.measuredActiveKcal;
    activeSource = "measured";
  } else if (bmrKcal != null) {
    activeKcal = bmrKcal * (ACTIVITY_MULTIPLIER[input.activityLevel] - 1);
    activeSource = "formula";
  } else {
    activeKcal = null;
    activeSource = null;
  }

  const tdeeKcal = basalKcal != null && activeKcal != null ? basalKcal + activeKcal : null;
  return { tdeeKcal, bmrKcal, basalKcal, basalSource, activeKcal, activeSource };
}

export interface GoalPlanInput {
  currentWeightKg: number;
  targetWeightKg: number;
  /** Magnitude only (kg/week, ≥ 0); direction is derived from target vs. current weight. */
  weeklyRateKg: number;
  tdeeKcal: number | null;
  bmrKcal: number | null;
  sex: Settings["profile"]["sex"];
  nowMs: number;
}

export interface GoalPlan {
  /** Signed: negative = deficit (losing), positive = surplus (gaining), 0 = already at goal. */
  dailyDeltaKcal: number;
  dailyTargetKcal: number | null;
  weeksToGoal: number | null;
  projectedAtMs: number | null;
  safeMinKcal: number;
  safeMinSource: "bmr" | "absolute";
  warnings: string[];
}

export function planWeightGoal({ currentWeightKg, targetWeightKg, weeklyRateKg, tdeeKcal, bmrKcal, sex, nowMs }: GoalPlanInput): GoalPlan {
  const warnings: string[] = [];
  const diffKg = targetWeightKg - currentWeightKg;
  const direction = Math.sign(diffKg); // -1 lose, 1 gain, 0 already there
  const rate = Math.max(0, weeklyRateKg);
  const dailyDeltaKcal = (direction * rate * KCAL_PER_KG) / 7;
  const dailyTargetKcal = tdeeKcal != null ? tdeeKcal + dailyDeltaKcal : null;

  const safeMinKcal = bmrKcal != null ? bmrKcal * 1.2 : sex === "male" ? ABSOLUTE_MIN_KCAL.male : sex === "female" ? ABSOLUTE_MIN_KCAL.female : ABSOLUTE_MIN_KCAL.fallback;
  const safeMinSource: GoalPlan["safeMinSource"] = bmrKcal != null ? "bmr" : "absolute";
  if (dailyTargetKcal != null && dailyTargetKcal < safeMinKcal) {
    warnings.push(
      `A target of ${Math.round(dailyTargetKcal)} kcal/day is below a safe minimum of about ${Math.round(safeMinKcal)} kcal/day${
        safeMinSource === "bmr" ? " (1.2× your estimated resting energy)" : " (general guidance — set height, birth year and sex in your profile for a personalised figure)"
      }. Consider a slower pace, or consult a doctor or dietitian.`,
    );
  }
  if (rate > 1) {
    warnings.push(`${rate} kg/week is faster than the commonly recommended safe pace of up to about 1 kg (roughly 1–2 lb) per week.`);
  }

  const weeksToGoal = direction === 0 ? 0 : rate > 0 ? Math.abs(diffKg) / rate : null;
  const projectedAtMs = weeksToGoal != null ? nowMs + weeksToGoal * 7 * 86_400_000 : null;

  return { dailyDeltaKcal, dailyTargetKcal, weeksToGoal, projectedAtMs, safeMinKcal, safeMinSource, warnings };
}
