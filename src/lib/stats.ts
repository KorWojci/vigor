/**
 * Generic least-squares linear regression, shared by anything that needs a trend line over time
 * (1RM progression, weight trend, …) instead of duplicating the same math per domain.
 */
export interface RegressionPoint {
  x: number;
  y: number;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Goodness of fit, 0–1 — how much of the variation in y the line explains. */
  r2: number;
  predict: (x: number) => number;
}

export function linearRegression(points: RegressionPoint[]): LinearFit | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((a, p) => a + p.x, 0) / n;
  const meanY = points.reduce((a, p) => a + p.y, 0) / n;
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  if (ssXX === 0) return null; // every point at the same x — no line to fit
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r2 = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY);
  return { slope, intercept, r2, predict: (x) => intercept + slope * x };
}
