import Link from "next/link";
import type { MetricSummary } from "@/lib/aggregation/series";
import { formatMetric, trendOf } from "@/lib/format";
import { formatDate } from "@/lib/time";
import type { UnitSystem } from "@/lib/units";
import { Sparkline } from "./charts";
import { Delta } from "./ui";

const MODE_LABEL: Record<string, string> = { sum: "daily average", avg: "average", latest: "latest", sleep: "average per night" };

/** One metric: value, unit, date, source, trend vs previous period and a sparkline. */
export function MetricTile({ summary, units, tz, rangeDays, label, href }: { summary: MetricSummary; units: UnitSystem; tz: string; rangeDays: number; label?: string; href?: string }) {
  const { def } = summary;
  const v = formatMetric(def, summary.value, units);
  const trend = trendOf(def, summary.value, summary.previous);
  const meta =
    summary.value === null
      ? null
      : def.aggregation === "latest"
        ? `${summary.latest ? formatDate(summary.latest.at, tz) : ""} · ${summary.latest?.sourceName ?? ""}`
        : `${MODE_LABEL[def.aggregation]} · ${summary.daysWithData}/${rangeDays} days with data`;
  return (
    <Link href={href ?? `/metrics/${def.key}`} className="card tile">
      <span className="label">{label ?? def.label}</span>
      {summary.value === null ? (
        <span className="empty">
          No data in this period
          {summary.latest && def.aggregation !== "latest" ? "" : ""}
        </span>
      ) : (
        <>
          <span className="value">
            {v.value}
            {v.unit && <span className="unit">{v.unit}</span>}
          </span>
          <span className="meta">{meta}</span>
          <Delta trend={trend} suffix={def.aggregation === "latest" ? "vs start of period" : "vs previous period"} />
        </>
      )}
      <Sparkline data={summary.daily.map((d) => ({ day: d.day, value: d.value }))} chart={def.chart} />
    </Link>
  );
}
