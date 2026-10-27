/**
 * A workout's GPS route: stored as a compact JSON array of [t, lat, lon, ele] tuples (seconds
 * since the workout's start, matching how cardio.ts times heart-rate and splits), not an array of
 * objects — a point-heavy route is the one place in this app where repeating key names in every
 * row would meaningfully bloat storage.
 */
export interface RoutePoint {
  t: number; // seconds since the workout's start
  lat: number;
  lon: number;
  ele: number | null; // metres
}

type EncodedPoint = [t: number, lat: number, lon: number, ele: number | null];

export function encodeRoute(points: RoutePoint[]): string {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const rows: EncodedPoint[] = sorted.map((p) => [p.t, p.lat, p.lon, p.ele]);
  return JSON.stringify(rows);
}

export function decodeRoute(raw: string | null): RoutePoint[] | null {
  if (!raw) return null;
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) return null;
    const points = rows
      .filter((r): r is EncodedPoint => Array.isArray(r) && r.length >= 3 && r.slice(0, 3).every((n) => typeof n === "number"))
      .map((r) => ({ t: r[0], lat: r[1], lon: r[2], ele: typeof r[3] === "number" ? r[3] : null }));
    return points.length ? points : null;
  } catch {
    return null;
  }
}

/** Metres between two points (equirectangular approximation — fine at the scale of a single workout route). */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const latMid = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = (b.lat - a.lat) * 110_540;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos(latMid);
  return Math.hypot(dLat, dLon);
}

export function routeDistanceMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += metresBetween(points[i - 1], points[i]);
  return total;
}
