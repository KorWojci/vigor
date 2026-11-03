"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { saveSleepSummary, saveWeeklyRecap, saveWorkoutRating, type RecapScope } from "@/lib/ai/repo";
import { generateSleepSummary } from "@/lib/ai/sleep-summary";
import { generateWeeklyRecap, generateWeeklyTrainingRecap } from "@/lib/ai/weekly-recap";
import { generateWorkoutRating } from "@/lib/ai/workout-rating";
import { config } from "@/lib/config";
import { db, requireUser } from "@/lib/server/context";
import { log } from "@/lib/server/log";
import { getSettings } from "@/lib/settings";

/** Shared by the Weekly recap card on Dashboard/Today ("full" scope) and Training ("training" scope) — each posts back to its own page via `returnTo`. */
export async function generateRecapAction(form: FormData) {
  await requireUser();
  const weekStart = String(form.get("weekStart") ?? "");
  const scope = (form.get("scope") === "training" ? "training" : "full") as RecapScope;
  const returnTo = String(form.get("returnTo") || "/");
  const apiKey = config.geminiApiKey;
  if (!apiKey) redirect(`${returnTo}?error=${encodeURIComponent("Set GEMINI_API_KEY in .env to enable the weekly recap — see .env.example.")}`);

  const database = db();
  const settings = getSettings(database);
  try {
    if (scope === "training") {
      const { result, prompt, model } = await generateWeeklyTrainingRecap(database, weekStart, settings.timezone, settings.units, apiKey, config.geminiModel);
      saveWeeklyRecap(database, { weekStart, scope, generatedAt: Date.now(), model, content: JSON.stringify(result), prompt });
    } else {
      const { result, prompt, model } = await generateWeeklyRecap(database, weekStart, settings.timezone, settings.units, apiKey, config.geminiModel);
      saveWeeklyRecap(database, { weekStart, scope, generatedAt: Date.now(), model, content: JSON.stringify(result), prompt });
    }
  } catch (e) {
    log("warn", "weekly_recap_failed", { scope, error: e instanceof Error ? e.message : "unknown" });
    redirect(`${returnTo}?error=${encodeURIComponent(e instanceof Error ? e.message : "Recap generation failed.")}`);
  }
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath("/training");
  redirect(`${returnTo}?ok=${encodeURIComponent("Weekly recap generated.")}`);
}

/** The AI rating card on a workout's own detail page. */
export async function generateWorkoutRatingAction(form: FormData) {
  await requireUser();
  const workoutId = Number(form.get("workoutId"));
  const returnTo = String(form.get("returnTo") || "/training");
  const apiKey = config.geminiApiKey;
  if (!apiKey) redirect(`${returnTo}?error=${encodeURIComponent("Set GEMINI_API_KEY in .env to enable the AI workout rating — see .env.example.")}`);

  const database = db();
  const settings = getSettings(database);
  try {
    const { rating, summary, prompt, model } = await generateWorkoutRating(database, workoutId, settings.units, settings.timezone, apiKey, config.geminiModel);
    saveWorkoutRating(database, { workoutId, generatedAt: Date.now(), model, rating, summary, prompt });
  } catch (e) {
    log("warn", "workout_rating_failed", { workoutId, error: e instanceof Error ? e.message : "unknown" });
    redirect(`${returnTo}?error=${encodeURIComponent(e instanceof Error ? e.message : "Rating generation failed.")}`);
  }
  revalidatePath(returnTo);
  redirect(`${returnTo}?ok=${encodeURIComponent("Workout rated.")}`);
}

/** The AI summary card on a sleep night's own detail page. */
export async function generateSleepSummaryAction(form: FormData) {
  await requireUser();
  const night = String(form.get("night") ?? "");
  const returnTo = String(form.get("returnTo") || "/metrics/sleep_analysis");
  const apiKey = config.geminiApiKey;
  if (!apiKey) redirect(`${returnTo}?error=${encodeURIComponent("Set GEMINI_API_KEY in .env to enable the AI sleep summary — see .env.example.")}`);

  const database = db();
  const settings = getSettings(database);
  try {
    const { summary, prompt, model } = await generateSleepSummary(database, night, settings.timezone, apiKey, config.geminiModel);
    saveSleepSummary(database, { night, generatedAt: Date.now(), model, summary, prompt });
  } catch (e) {
    log("warn", "sleep_summary_failed", { night, error: e instanceof Error ? e.message : "unknown" });
    redirect(`${returnTo}?error=${encodeURIComponent(e instanceof Error ? e.message : "Summary generation failed.")}`);
  }
  revalidatePath(returnTo);
  redirect(`${returnTo}?ok=${encodeURIComponent("Sleep summary generated.")}`);
}
