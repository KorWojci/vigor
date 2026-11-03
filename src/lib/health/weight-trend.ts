import { linearRegression } from "../stats";

/**
 * Linear trend through logged body weight, independent of the calorie-goal math in
 * calorie-goal.ts — a sanity check against it, from what's actually happened rather than what the
 * calorie math implies should happen.
 */
export interface WeightPoint {
  atMs: number;
  weightKg: number;
}

export interface WeightTrend {
  /** kg gained (or lost) per day, from the regression line. */
  slopeKgPerDay: number;
  /** The regression line's value at the most recent reading's date. */
  currentKg: number;
  /** Goodness of fit, 0–1 — how much of the reading-to-reading variation the line explains. */
  r2: number;
  predictAt: (ms: number) => number;
  /** First future date the trend line reaches this weight, or null if it isn't heading there (wrong direction, or flat). */
  dateToReach: (targetKg: number) => number | null;
}

/** Below this many readings, or this short a span, day-to-day weight noise (water, food, timing) swamps any real trend. */
const MIN_READINGS = 5;
const MIN_SPAN_DAYS = 14;

/** A straight-line trend through weight readings, oldest first. Null when there isn't enough data for a trend to mean anything. */
export function weightTrend(points: WeightPoint[]): WeightTrend | null {
  if (points.length < MIN_READINGS) return null;
  const first = points[0].atMs;
  const last = points[points.length - 1].atMs;
  if ((last - first) / 86_400_000 < MIN_SPAN_DAYS) return null;

  const fit = linearRegression(points.map((p) => ({ x: (p.atMs - first) / 86_400_000, y: p.weightKg })));
  if (!fit) return null;
  const predictAt = (ms: number) => fit.predict((ms - first) / 86_400_000);
  const dateToReach = (targetKg: number): number | null => {
    if (fit.slope === 0) return null;
    const ms = first + ((targetKg - fit.intercept) / fit.slope) * 86_400_000;
    return ms > last ? ms : null; // only a future crossing counts as a forecast
  };
  return { slopeKgPerDay: fit.slope, currentKg: predictAt(last), r2: fit.r2, predictAt, dateToReach };
}
