/**
 * Time-zone helpers. Storage is always UTC epoch milliseconds; days are computed in the
 * user's configured IANA time zone (Settings → Application → Time zone).
 */

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(tz: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(tz, f);
  }
  return f;
}

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar day (YYYY-MM-DD) of an instant. */
export function dayKey(ms: number, tz: string): string {
  return dayFormatter(tz).format(new Date(ms));
}

/** Local hour bucket (YYYY-MM-DDTHH) of an instant. */
export function hourKey(ms: number, tz: string): string {
  const p = wallParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(ms: number, tz: string): WallParts {
  const parts = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC instant. */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes handle DST transitions.
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz);
  return ms;
}

/** UTC instant of local midnight starting `day` (YYYY-MM-DD) in `tz`. */
export function startOfDayMs(day: string, tz: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return zonedWallTimeToUtc(y, m, d, 0, 0, 0, tz);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive list of days between two day keys. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface DateRange {
  /** inclusive first local day */
  from: string;
  /** inclusive last local day */
  to: string;
  startMs: number;
  endMs: number; // exclusive
  days: number;
}

export function rangeFromDays(days: number, tz: string, now = Date.now()): DateRange {
  const to = dayKey(now, tz);
  const from = addDays(to, -(days - 1));
  return makeRange(from, to, tz);
}

export function makeRange(from: string, to: string, tz: string): DateRange {
  return {
    from,
    to,
    startMs: startOfDayMs(from, tz),
    endMs: startOfDayMs(addDays(to, 1), tz),
    days: daysBetween(from, to).length,
  };
}

/** The period of equal length immediately before `r`. */
export function previousRange(r: DateRange, tz: string): DateRange {
  const to = addDays(r.from, -1);
  const from = addDays(to, -(r.days - 1));
  return makeRange(from, to, tz);
}

export const RANGE_PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "all", label: "5 years", days: 365 * 5 },
] as const;
export type RangePresetKey = (typeof RANGE_PRESETS)[number]["key"];

export function presetDays(key: string | undefined, fallback: RangePresetKey = "30d"): { key: RangePresetKey; days: number } {
  const p = RANGE_PRESETS.find((r) => r.key === key) ?? RANGE_PRESETS.find((r) => r.key === fallback)!;
  return { key: p.key, days: p.days };
}

export function formatDateTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatDate(msOrDay: number | string, tz: string): string {
  const ms = typeof msOrDay === "string" ? startOfDayMs(msOrDay, tz) + 12 * 3600_000 : msOrDay;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "short", day: "numeric" }).format(new Date(ms));
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = now - ms;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let s: string;
  if (mins < 1) s = "just now";
  else if (mins < 60) s = `${mins} min`;
  else if (mins < 60 * 48) s = `${Math.round(mins / 60)} h`;
  else s = `${Math.round(mins / 1440)} days`;
  if (s === "just now") return s;
  return diff >= 0 ? `${s} ago` : `in ${s}`;
}

/** Monday (YYYY-MM-DD) of the local week containing `ms`. */
export function weekStart(ms: number, tz: string): string {
  const day = dayKey(ms, tz);
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}
