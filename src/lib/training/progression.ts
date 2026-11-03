import { linearRegression } from "../stats";

/**
 * Linear trend through a lift's estimated-1RM history, for the "Progress" chart on the exercise
 * page. Least-squares regression in kg/day — canonical units in, canonical units out; convert for
 * display only, like everywhere else in Vigor.
 */
export interface E1rmPoint {
  startMs: number;
  e1rmKg: number;
}

export interface E1rmTrend {
  /** kg gained (or lost) per day, from the regression line. */
  slopeKgPerDay: number;
  /** The regression line's value at the most recent session's date. */
  currentKg: number;
  /** Goodness of fit, 0–1 — how much of the session-to-session variation the line explains. */
  r2: number;
  /** The regression line's value at any point in time (ms epoch). */
  predictAt: (ms: number) => number;
}

/** Below this many sessions, or this short a span, per-session e1RM noise (fatigue, RPE, rep range) swamps any real trend. */
const MIN_SESSIONS = 4;
const MIN_SPAN_DAYS = 14;

/**
 * A straight-line trend through a lift's best-e1RM-per-session history, oldest first. Null when
 * there isn't enough data for a trend to mean anything, rather than reporting a noisy guess.
 */
export function e1rmTrend(points: E1rmPoint[]): E1rmTrend | null {
  if (points.length < MIN_SESSIONS) return null;
  const first = points[0].startMs;
  const last = points[points.length - 1].startMs;
  if ((last - first) / 86_400_000 < MIN_SPAN_DAYS) return null;

  const fit = linearRegression(points.map((p) => ({ x: (p.startMs - first) / 86_400_000, y: p.e1rmKg })));
  if (!fit) return null; // every session on the same day — no time axis to regress on
  const predictAt = (ms: number) => fit.predict((ms - first) / 86_400_000);
  return { slopeKgPerDay: fit.slope, currentKg: predictAt(last), r2: fit.r2, predictAt };
}
