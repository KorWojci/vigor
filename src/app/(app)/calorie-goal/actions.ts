"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getMetricSummary } from "@/lib/aggregation/series";
import { classifyActivityLevel, MIN_DAYS_FOR_MEASURED } from "@/lib/health/calorie-goal";
import { db, requireUser } from "@/lib/server/context";
import { getSetting, setSetting, type Settings } from "@/lib/settings";
import { previousRange, rangeFromDays } from "@/lib/time";
import { fromDisplay } from "@/lib/units";

const ACTIVITY_LEVEL_KEYS = ["sedentary", "light", "moderate", "active", "very_active"];

/** Resolves "auto" to a concrete level from the last 30 days of steps/exercise minutes; never stored as "auto" itself. */
function resolveActivityLevel(database: ReturnType<typeof db>, submitted: string, tz: string): { level: string; source: "submitted" | "estimated" | "estimate-failed" } {
  if (submitted !== "auto") return { level: ACTIVITY_LEVEL_KEYS.includes(submitted) ? submitted : "moderate", source: "submitted" };
  const range = rangeFromDays(30, tz);
  const previous = previousRange(range, tz);
  const steps = getMetricSummary(database, "step_count", range, previous, tz);
  const exercise = getMetricSummary(database, "exercise_time", range, previous, tz);
  const level = classifyActivityLevel({
    avgStepsPerDay: steps && steps.daysWithData >= MIN_DAYS_FOR_MEASURED ? steps.value : null,
    avgExerciseMinPerWeek: exercise && exercise.daysWithData >= MIN_DAYS_FOR_MEASURED && exercise.value != null ? exercise.value * 7 : null,
  });
  return level ? { level, source: "estimated" } : { level: "moderate", source: "estimate-failed" };
}

export async function saveGoalAction(form: FormData) {
  await requireUser();
  const database = db();
  const units = getSetting(database, "units");
  const tz = getSetting(database, "timezone");
  const targetRaw = Number(form.get("targetWeight"));
  const rateRaw = Number(form.get("weeklyRate"));
  const { level: activityLevel, source } = resolveActivityLevel(database, String(form.get("activityLevel") ?? "moderate"), tz);
  try {
    setSetting(database, "weightGoal", {
      targetWeightKg: Number.isFinite(targetRaw) && targetRaw > 0 ? fromDisplay(targetRaw, "kg", units) : undefined,
      weeklyRateKg: Number.isFinite(rateRaw) ? Math.min(1.5, Math.max(0, rateRaw)) : 0.5,
      activityLevel: activityLevel as Settings["weightGoal"]["activityLevel"],
    });
  } catch {
    redirect(`/calorie-goal?error=${encodeURIComponent("Invalid goal values.")}`);
  }
  revalidatePath("/calorie-goal");
  if (source === "estimate-failed") redirect(`/calorie-goal?error=${encodeURIComponent('Not enough step/exercise data yet to calculate automatically — kept "moderate". Everything else was saved.')}`);
  const msg = source === "estimated" ? `Goal saved. Activity level estimated as "${activityLevel.replace("_", " ")}" from your last 30 days.` : "Goal saved.";
  redirect(`/calorie-goal?ok=${encodeURIComponent(msg)}`);
}
