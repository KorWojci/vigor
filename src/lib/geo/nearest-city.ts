/**
 * Offline "where was this?" lookup for workout routes — no network call, ever (see CLAUDE.md:
 * no external calls from server or client). `cities.json` is a one-time, build-time export
 * (lat, lon, name, ISO country code, population) trimmed from the `all-the-cities` npm package
 * (GeoNames data) to every city with population ≥ 15,000 — about 24k entries, ~1 MB. See the
 * generation note at the bottom of this file if the list ever needs regenerating.
 */
import cities from "./cities.json";

export interface CityMatch {
  name: string;
  country: string;
  distanceKm: number;
}

type CityRow = [lat: number, lon: number, name: string, country: string, population: number];
const CITIES = cities as CityRow[];

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Nearest known city to a point, however far it is — callers decide what "far" means for their
 * display (see placeLabel below). A plain linear scan of ~24k rows is well under a millisecond;
 * this is called once per workout page view, not in a hot loop.
 */
export function nearestCity(lat: number, lon: number): CityMatch | null {
  let best: CityMatch | null = null;
  for (const [cLat, cLon, name, country] of CITIES) {
    const d = haversineKm(lat, lon, cLat, cLon);
    if (!best || d < best.distanceKm) best = { name, country, distanceKm: d };
  }
  return best;
}

/**
 * A short, honest label for a point, or null rather than guessing. Never claims a city the point
 * wasn't actually near — a training run in open countryside shows no place rather than the
 * nearest town 40 km away mislabelled as "where you trained".
 */
export function placeLabel(lat: number, lon: number): string | null {
  const m = nearestCity(lat, lon);
  if (!m) return null;
  if (m.distanceKm <= 15) return `${m.name}, ${m.country}`;
  if (m.distanceKm <= 80) return `near ${m.name}, ${m.country} (~${Math.round(m.distanceKm)} km)`;
  return null;
}

/*
 * Regenerating cities.json:
 *   npm install all-the-cities   (temporary — remove again afterwards, it's not a runtime dependency)
 *   node -e '
 *     const cities = require("all-the-cities");
 *     const rows = cities.filter(c => c.population >= 15000)
 *       .map(c => [Math.round(c.loc.coordinates[1]*10000)/10000, Math.round(c.loc.coordinates[0]*10000)/10000, c.name, c.country, c.population]);
 *     require("fs").writeFileSync("src/lib/geo/cities.json", JSON.stringify(rows));
 *   '
 *   npm uninstall all-the-cities
 */
