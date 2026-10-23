import Link from "next/link";
import type { MetricSummary } from "@/lib/aggregation/series";
import { formatMetric, trendOf } from "@/lib/format";
import type { UnitSystem } from "@/lib/units";
import { Delta } from "./ui";

const META: Record<string, string> = { sum: "so far today", avg: "today's average so far", sleep: "so far today", latest: "latest today" };

/**
 * One metric for the Today page: today's value with a "vs yesterday" comparison instead of the
 * sparkline/period framing MetricTile uses — a single day has no trend line worth drawing.
 */
export function TodayTile({ summary, units, label }: { summary: MetricSummary; units: UnitSystem; label?: string }) {
  const { def } = summary;
  const v = formatMetric(def, summary.value, units);
  const trend = trendOf(def, summary.value, summary.previous);
  return (
    <Link href={`/metrics/${def.key}`} className="card tile">
      <span className="label">{label ?? def.label}</span>
      {summary.value === null ? (
        <span className="empty">No data yet today</span>
      ) : (
        <>
          <span className="value">
            {v.value}
            {v.unit && <span className="unit">{v.unit}</span>}
          </span>
          <span className="meta">{META[def.aggregation]}</span>
          <Delta trend={trend} suffix="vs yesterday" />
        </>
      )}
    </Link>
  );
}
