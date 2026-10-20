import { getMetric, type MetricDef } from "./metrics/catalog";
import { formatDuration, formatNumber, toDisplay, type UnitSystem } from "./units";

/** Formats a canonical metric value for display in the user's unit system. */
export function formatMetric(def: MetricDef | string, value: number | null | undefined, units: UnitSystem): { value: string; unit: string } {
  const d = typeof def === "string" ? getMetric(def) : def;
  if (value === null || value === undefined || !d) return { value: "—", unit: "" };
  if (d.key === "sleep_analysis") return { value: formatDuration(value), unit: "" };
  const disp = toDisplay(value, d.unit, units);
  const decimals = d.unit === "m" ? 2 : d.decimals;
  return { value: formatNumber(disp.value, decimals), unit: disp.unit };
}

export function formatMetricText(def: MetricDef | string, value: number | null | undefined, units: UnitSystem): string {
  const f = formatMetric(def, value, units);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

/** Relative change and whether it is an improvement for this metric. */
export function trendOf(def: MetricDef, current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  const diff = current - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  const direction = Math.abs(pct) < 0.5 ? "flat" : diff > 0 ? "up" : "down";
  const tone = direction === "flat" || !def.better ? "neutral" : direction === def.better ? "good" : "bad";
  return { diff, pct, direction, tone } as const;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
