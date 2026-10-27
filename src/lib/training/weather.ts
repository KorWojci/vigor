/**
 * Weather at the time of a workout — read from the metadata Apple Watch already attaches to
 * outdoor workouts on-device (HKMetadataKeyWeatherTemperature/Humidity/Condition), not fetched
 * from a weather API. No network call, no extra permission: it comes bundled with the workout
 * object the app already reads. See docs/apple-health-sync.md.
 *
 * HealthKit has no numeric wind speed for a workout — only a qualitative condition (windy,
 * blustery, etc.), which is what `condition` reflects. We never invent a wind speed.
 */
export interface Weather {
  tempC: number | null;
  humidityPct: number | null;
  /** Raw HKWeatherCondition value from the client; see WEATHER_CONDITIONS below. */
  conditionCode: number | null;
}

/**
 * HKWeatherCondition raw values (HealthKit, iOS 16+). Unlisted/unknown codes fall back to
 * showing nothing rather than a wrong label.
 */
export const WEATHER_CONDITIONS: Record<number, string> = {
  0: "Unknown",
  1: "Clear",
  2: "Fair",
  3: "Partly cloudy",
  4: "Mostly cloudy",
  5: "Cloudy",
  6: "Foggy",
  7: "Haze",
  8: "Windy",
  9: "Blustery",
  10: "Smoky",
  11: "Dusty",
  12: "Snow",
  13: "Hail",
  14: "Sleet",
  15: "Freezing drizzle",
  16: "Freezing rain",
  17: "Mixed rain and hail",
  18: "Mixed rain and snow",
  19: "Mixed rain and sleet",
  20: "Mixed snow and sleet",
  21: "Drizzle",
  22: "Scattered showers",
  23: "Showers",
  24: "Thunderstorms",
  25: "Tropical storm",
  26: "Hurricane",
  27: "Tornado",
};

export function weatherConditionLabel(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return WEATHER_CONDITIONS[code] ?? null;
}

export function encodeWeather(w: Weather | null | undefined): string | null {
  if (!w || (w.tempC === null && w.humidityPct === null && w.conditionCode === null)) return null;
  return JSON.stringify(w);
}

export function decodeWeather(raw: string | null): Weather | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as unknown;
    if (!w || typeof w !== "object") return null;
    const o = w as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return { tempC: num(o.tempC), humidityPct: num(o.humidityPct), conditionCode: num(o.conditionCode) };
  } catch {
    return null;
  }
}
