"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, requireUser } from "@/lib/server/context";
import { getSetting, setSetting, type Settings } from "@/lib/settings";
import { fromDisplay } from "@/lib/units";

const ACTIVITY_LEVEL_KEYS = ["sedentary", "light", "moderate", "active", "very_active"];

export async function saveGoalAction(form: FormData) {
  await requireUser();
  const database = db();
  const units = getSetting(database, "units");
  const targetRaw = Number(form.get("targetWeight"));
  const rateRaw = Number(form.get("weeklyRate"));
  const activityLevel = String(form.get("activityLevel") ?? "moderate");
  try {
    setSetting(database, "weightGoal", {
      targetWeightKg: Number.isFinite(targetRaw) && targetRaw > 0 ? fromDisplay(targetRaw, "kg", units) : undefined,
      weeklyRateKg: Number.isFinite(rateRaw) ? Math.min(1.5, Math.max(0, rateRaw)) : 0.5,
      activityLevel: (ACTIVITY_LEVEL_KEYS.includes(activityLevel) ? activityLevel : "moderate") as Settings["weightGoal"]["activityLevel"],
    });
  } catch {
    redirect(`/calorie-goal?error=${encodeURIComponent("Invalid goal values.")}`);
  }
  revalidatePath("/calorie-goal");
  redirect(`/calorie-goal?ok=${encodeURIComponent("Goal saved.")}`);
}
