import { z } from "zod";
import type { DB } from "../db";
import { getSleepNights } from "../aggregation/series";
import { callGemini, parseJsonResponse } from "./gemini";
import { addDays, formatDateTime, makeRange } from "../time";
import { formatDuration } from "../units";

/** Per-night AI sleep summary — same explicit-trigger-only exception as the weekly recap and workout rating (CLAUDE.md invariant 9). */

export interface SleepSummaryContext {
  date: string;
  asleepMinutes: number;
  inBedMinutes: number | null;
  awakeMinutes: number;
  hasStages: boolean;
  deepMinutes: number | null;
  remMinutes: number | null;
  coreMinutes: number | null;
  bedtimeMs: number;
  wakeMs: number;
  /** Average asleep minutes over the prior nights (RECENT_LOOKBACK_DAYS), excluding this one — null if there isn't enough history. */
  avgRecentAsleepMinutes: number | null;
}

const RECENT_LOOKBACK_DAYS = 14;

/** Gathers one night's own data plus Vigor-computed context (recent average) — no judgement, just facts. */
export function buildSleepSummaryContext(db: DB, night: string, tz: string): SleepSummaryContext | null {
  const range = makeRange(addDays(night, -RECENT_LOOKBACK_DAYS), night, tz);
  const nights = getSleepNights(db, range, tz);
  const target = nights.find((n) => n.day === night);
  if (!target) return null;
  const others = nights.filter((n) => n.day !== night);
  const avgRecentAsleepMinutes = others.length ? others.reduce((a, n) => a + n.asleepMin, 0) / others.length : null;
  return {
    date: target.day,
    asleepMinutes: target.asleepMin,
    inBedMinutes: target.inBedMin,
    awakeMinutes: target.awakeMin,
    hasStages: target.hasStages,
    deepMinutes: target.hasStages ? target.stages.deep : null,
    remMinutes: target.hasStages ? target.stages.rem : null,
    coreMinutes: target.hasStages ? target.stages.core : null,
    bedtimeMs: target.startMs,
    wakeMs: target.endMs,
    avgRecentAsleepMinutes,
  };
}

export const SLEEP_SUMMARY_SYSTEM_INSTRUCTIONS = `You are a concise, factual sleep assistant inside a personal health-tracking app called Vigor. You will be given one night's own logged sleep data as JSON, including how it compares to the user's recent average (computed by the app, not by you — never recompute or contradict it). Respond with ONLY a single JSON object (no markdown fences, no extra text) matching exactly this shape:

{
  "summary": string  // 2-4 sentences, plain prose
}

Rules:
- Only state facts present in the JSON you are given. Never invent a number or comparison that isn't there.
- Mention how this night compares to the recent average when that data is available; don't invent a comparison if it isn't.
- Do not give medical advice or diagnose a sleep disorder. A simple, plain observation is fine; speculating about causes you have no data for is not.
- Output must be valid JSON and nothing else.`;

export const sleepSummaryResultSchema = z.object({ summary: z.string().min(1) });
export type SleepSummaryResult = z.infer<typeof sleepSummaryResultSchema>;

/** Pure and testable: no network, no DB. */
export function buildSleepSummaryPrompt(ctx: SleepSummaryContext, tz: string): string {
  const clock = (ms: number) => formatDateTime(ms, tz).split(", ")[1];
  const payload = {
    date: ctx.date,
    bedtime: clock(ctx.bedtimeMs),
    wake: clock(ctx.wakeMs),
    asleep: formatDuration(ctx.asleepMinutes),
    inBed: ctx.inBedMinutes != null ? formatDuration(ctx.inBedMinutes) : null,
    awake: formatDuration(ctx.awakeMinutes),
    deep: ctx.deepMinutes != null ? formatDuration(ctx.deepMinutes) : null,
    rem: ctx.remMinutes != null ? formatDuration(ctx.remMinutes) : null,
    core: ctx.coreMinutes != null ? formatDuration(ctx.coreMinutes) : null,
    recentAverageAsleep: ctx.avgRecentAsleepMinutes != null ? formatDuration(ctx.avgRecentAsleepMinutes) : null,
  };
  return `Here is this night's sleep data, as JSON:\n${JSON.stringify(payload, null, 2)}`;
}

export async function generateSleepSummary(db: DB, night: string, tz: string, apiKey: string, model: string): Promise<{ summary: string; prompt: string; model: string }> {
  const ctx = buildSleepSummaryContext(db, night, tz);
  if (!ctx) throw new Error("No sleep data for that night.");
  const prompt = buildSleepSummaryPrompt(ctx, tz);
  const res = await callGemini(prompt, SLEEP_SUMMARY_SYSTEM_INSTRUCTIONS, apiKey, model, { jsonMode: true, maxOutputTokens: 300 });
  const parsed = parseJsonResponse(res.text, sleepSummaryResultSchema, "Sleep summary");
  return { summary: parsed.summary, prompt, model };
}
