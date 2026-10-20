/**
 * Unit handling. Every stored value uses a canonical unit; incoming values are converted
 * with `toCanonical`, and values are converted for display with the helpers below.
 */

type Converter = (v: number) => number;
const id: Converter = (v) => v;
const scale =
  (f: number): Converter =>
  (v) =>
    v * f;

/** canonical unit → accepted input unit (lower-cased, normalised) → converter */
const CONVERSIONS: Record<string, Record<string, Converter>> = {
  count: { count: id, "": id, steps: id, flights: id },
  m: { m: id, km: scale(1000), mi: scale(1609.344), ft: scale(0.3048), yd: scale(0.9144), cm: scale(0.01) },
  cm: { cm: id, m: scale(100), mm: scale(0.1), in: scale(2.54), ft: scale(30.48) },
  kg: { kg: id, g: scale(0.001), lb: scale(0.45359237), lbs: scale(0.45359237), st: scale(6.35029318) },
  kcal: { kcal: id, cal: id, kj: scale(1 / 4.184), j: scale(1 / 4184) },
  min: { min: id, s: scale(1 / 60), sec: scale(1 / 60), h: scale(60), hr: scale(60) },
  hr: { hr: id, h: id, count: id, min: scale(1 / 60) },
  bpm: { bpm: id, "count/min": id, "beats/min": id, "/min": id },
  "breaths/min": { "breaths/min": id, "count/min": id, "/min": id },
  ms: { ms: id, s: scale(1000) },
  "%": { "%": id, percent: id, fraction: scale(100) },
  "ml/kg/min": { "ml/kg/min": id, "ml/(kg·min)": id, "ml/(kg*min)": id, "ml/kg·min": id },
  "°c": { "°c": id, degc: id, c: id, "°f": (v) => ((v - 32) * 5) / 9, degf: (v) => ((v - 32) * 5) / 9, f: (v) => ((v - 32) * 5) / 9 },
  mmhg: { mmhg: id },
  "mg/dl": { "mg/dl": id, "mmol/l": scale(18.0182) },
  ml: { ml: id, l: scale(1000), "fl_oz_us": scale(29.5735), "fl oz": scale(29.5735), floz: scale(29.5735), cup_us: scale(236.588) },
  g: { g: id, mg: scale(0.001), mcg: scale(0.000001), µg: scale(0.000001), kg: scale(1000), oz: scale(28.3495) },
  "kg/m²": { "kg/m²": id, "kg/m^2": id, "kg/m2": id, count: id, "": id },
  none: { "": id, none: id },
};

export function normalizeUnit(u: string): string {
  return u.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Converts a value to the canonical unit. Returns null when the unit is not convertible. */
export function toCanonical(value: number, fromUnit: string, canonicalUnit: string): number | null {
  const table = CONVERSIONS[normalizeUnit(canonicalUnit)];
  if (!table) return null;
  const conv = table[normalizeUnit(fromUnit)];
  if (!conv) return null;
  const out = conv(value);
  return Number.isFinite(out) ? out : null;
}

export function acceptedUnits(canonicalUnit: string): string[] {
  return Object.keys(CONVERSIONS[normalizeUnit(canonicalUnit)] ?? {}).filter(Boolean);
}

export type UnitSystem = "metric" | "imperial";

export interface DisplayValue {
  value: number;
  unit: string;
}

/** Converts a canonical value into the user's preferred display unit. */
export function toDisplay(value: number, canonicalUnit: string, system: UnitSystem): DisplayValue {
  const u = normalizeUnit(canonicalUnit);
  if (system === "imperial") {
    switch (u) {
      case "kg":
        return { value: value / 0.45359237, unit: "lb" };
      case "cm":
        return { value: value / 2.54, unit: "in" };
      case "m":
        return value >= 1000 || value === 0 ? { value: value / 1609.344, unit: "mi" } : { value: value / 0.3048, unit: "ft" };
      case "°c":
        return { value: (value * 9) / 5 + 32, unit: "°F" };
      case "ml":
        return { value: value / 29.5735, unit: "fl oz" };
    }
  }
  switch (u) {
    case "m":
      return { value: value / 1000, unit: "km" };
    case "°c":
      return { value, unit: "°C" };
    case "ml":
      return value >= 1000 ? { value: value / 1000, unit: "L" } : { value, unit: "mL" };
    case "mmhg":
      return { value, unit: "mmHg" };
    case "mg/dl":
      return { value, unit: "mg/dL" };
    case "ml/kg/min":
      return { value, unit: "mL/kg·min" };
    case "count":
      return { value, unit: "" };
    default:
      return { value, unit: canonicalUnit };
  }
}

/** Converts a value typed in the display unit back to canonical (used by manual entry forms). */
export function fromDisplay(value: number, canonicalUnit: string, system: UnitSystem): number {
  const u = normalizeUnit(canonicalUnit);
  if (system === "imperial") {
    if (u === "kg") return value * 0.45359237;
    if (u === "cm") return value * 2.54;
  }
  return value;
}

export function displayUnitFor(canonicalUnit: string, system: UnitSystem): string {
  return toDisplay(1000, canonicalUnit, system).unit;
}

export function formatNumber(value: number, decimals = 1): string {
  const d = Math.abs(value) >= 1000 ? 0 : decimals;
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/** Formats minutes as "7 h 32 min". */
export function formatDuration(minutes: number): string {
  if (minutes > 0 && minutes < 1) return `${Math.round(minutes * 60)} s`;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
