import Link from "next/link";
import { notFound } from "next/navigation";
import { SleepChart, TrendChart } from "@/components/charts";
import { Delta, EmptyState, PageHead, RangeSelector } from "@/components/ui";
import { getMetricSummary, getRecentSamples, getSleepNights, getSourceBreakdown } from "@/lib/aggregation/series";
import { MEASUREMENT_METRIC_LINKS } from "@/lib/body/measurement-types";
import { formatMetric, formatMetricText, trendOf } from "@/lib/format";
import { getMetric, METRIC_GROUPS } from "@/lib/metrics/catalog";
import { appContext, db } from "@/lib/server/context";
import { formatDate, formatDateTime, presetDays, previousRange, rangeFromDays } from "@/lib/time";
import { formatDuration, toDisplay } from "@/lib/units";

const AGG_TEXT = {
  sum: "Daily totals. When several devices record the same activity, Vigor keeps the source with the larger total per hour (or per day for daily summaries) so nothing is double-counted.",
  sumAll: "Daily totals of every logged entry, across all sources.",
  avg: "Daily average of all readings; the shaded band shows the daily minimum–maximum.",
  latest: "The last reading of each day. Manual entries from Body measurements are merged with imported readings.",
  sleep: "Sleep per night, attributed to the day you wake up (a sleep day runs 18:00–18:00). Overlapping samples from several apps are merged as time intervals.",
};

export default async function MetricDetail({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const { type } = await params;
  const sp = await searchParams;
  const def = getMetric(type);
  if (!def) notFound();
  const database = db();
  const units = settings.units;
  const preset = presetDays(sp.range, settings.defaultRange as never);
  const range = rangeFromDays(preset.days, tz);
  const prev = previousRange(range, tz);
  const summary = getMetricSummary(database, def.key, range, prev, tz)!;
  const unit = toDisplay(1000, def.unit, units).unit;
  const conv = (v: number) => (def.key === "sleep_analysis" ? v : toDisplay(v, def.unit, units).value);
  const decimals = def.unit === "m" ? 2 : def.decimals;
  const values = summary.daily.map((d) => d.value);
  const sources = getSourceBreakdown(database, def.key, range);
  const samples = getRecentSamples(database, def.key, range, 40);
  const nights = def.aggregation === "sleep" ? getSleepNights(database, range, tz) : [];
  const measurementKey = Object.entries(MEASUREMENT_METRIC_LINKS).find(([, m]) => m === def.key)?.[0];
  const group = METRIC_GROUPS.find((g) => g.key === def.group)?.label;
  const v = formatMetric(def, summary.value, units);

  // Bar charts show every day of the range so gaps are visible; line charts connect readings.
  const byDay = new Map(summary.daily.map((d) => [d.day, d]));
  const allDays: string[] = [];
  for (let d = range.from; d <= range.to; d = new Date(Date.parse(d + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10)) allDays.push(d);
  const chartData =
    def.chart === "bar"
      ? allDays.map((day) => ({ day, value: byDay.has(day) ? conv(byDay.get(day)!.value) : null }))
      : summary.daily.map((d) => ({ day: d.day, value: conv(d.value), min: d.min != null ? conv(d.min) : null, max: d.max != null ? conv(d.max) : null }));

  return (
    <>
      <PageHead eyebrow={group} title={def.label} sub={<span className="small">{def.description ?? `Canonical unit: ${def.unit}${def.healthKit ? ` · HealthKit: ${def.healthKit}` : ""}`}</span>}>
        <RangeSelector current={preset.key} basePath={`/metrics/${def.key}`} />
      </PageHead>

      {summary.daysWithData === 0 ? (
        <div className="card">
          <EmptyState title="No data in this period">
            <p>
              Vigor has no {def.label.toLowerCase()} records between {formatDate(range.from, tz)} and {formatDate(range.to, tz)}. This is shown as missing,
              not as zero.
            </p>
            <p className="small">
              {measurementKey ? (
                <>You can <Link href={`/body?type=${measurementKey}`}>enter it manually</Link>, or </>
              ) : (
                "Make sure "
              )}
              {measurementKey ? "make sure " : ""}the type is included in your Apple Health sync and that read permission was granted. Try a longer range above.
            </p>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="grid grid-4">
            <div className="card tile">
              <span className="label">{def.aggregation === "latest" ? "Latest" : def.aggregation === "sleep" ? "Avg per night" : def.aggregation === "sum" ? "Daily average" : "Average"}</span>
              <span className="value">{v.value}<span className="unit">{v.unit}</span></span>
              <Delta trend={trendOf(def, summary.value, summary.previous)} />
            </div>
            <div className="card tile">
              <span className="label">Lowest day</span>
              <span className="value">{formatMetric(def, Math.min(...values), units).value}<span className="unit">{def.key === "sleep_analysis" ? "" : unit}</span></span>
            </div>
            <div className="card tile">
              <span className="label">Highest day</span>
              <span className="value">{formatMetric(def, Math.max(...values), units).value}<span className="unit">{def.key === "sleep_analysis" ? "" : unit}</span></span>
            </div>
            <div className="card tile">
              <span className="label">Coverage</span>
              <span className="value">{summary.daysWithData}<span className="unit">/ {range.days} days</span></span>
              <span className="meta">{summary.latest ? `latest ${formatDate(summary.latest.at, tz)}` : ""}</span>
            </div>
          </section>

          <section className="card section">
            <div className="card-head">
              <h2>History</h2>
              <span className="small muted">{unit && def.key !== "sleep_analysis" ? unit : ""}</span>
            </div>
            {def.aggregation === "sleep" ? (
              <SleepChart data={nights.map((n) => ({ day: n.day, ...n.stages, awake: n.awakeMin }))} />
            ) : (
              <TrendChart data={chartData} unit={unit} chart={def.chart} decimals={decimals} movingAverage={settings.movingAverageDays} showRange={def.aggregation === "avg"} label={def.label} />
            )}
            <p className="tiny faint" style={{ marginTop: 8 }}>
              {def.aggregation === "sum" ? (def.overlap === "sum-all" ? AGG_TEXT.sumAll : AGG_TEXT.sum) : AGG_TEXT[def.aggregation]}
              {settings.movingAverageDays > 0 && def.aggregation !== "sleep" ? ` Dashed line: ${settings.movingAverageDays}-day moving average.` : ""}
            </p>
          </section>
        </>
      )}

      {def.aggregation === "sleep" && nights.length > 0 && (
        <section className="card section">
          <h2>Nights</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Night ending</th><th>Bed → wake</th><th className="r">Asleep</th><th className="r">In bed</th><th className="r">Deep</th><th className="r">Core</th><th className="r">REM</th><th className="r">Awake</th><th>Sources</th></tr>
              </thead>
              <tbody>
                {[...nights].reverse().slice(0, 60).map((n) => (
                  <tr key={n.day}>
                    <td>{formatDate(n.day, tz)}</td>
                    <td className="small muted">{formatDateTime(n.startMs, tz).split(", ")[1]} → {formatDateTime(n.endMs, tz).split(", ")[1]}</td>
                    <td className="r num">{formatDuration(n.asleepMin)}</td>
                    <td className="r num">{n.inBedMin === null ? "—" : formatDuration(n.inBedMin)}</td>
                    <td className="r num">{n.hasStages ? formatDuration(n.stages.deep) : "—"}</td>
                    <td className="r num">{n.hasStages ? formatDuration(n.stages.core) : "—"}</td>
                    <td className="r num">{n.hasStages ? formatDuration(n.stages.rem) : "—"}</td>
                    <td className="r num">{formatDuration(n.awakeMin)}</td>
                    <td className="small muted">{n.sources.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny faint">Stage columns show “—” when the source records only “asleep” without stages (e.g. older devices or some third-party apps).</p>
        </section>
      )}

      <section className="grid grid-2 section">
        <div className="card">
          <h2>Sources in this period</h2>
          {sources.length === 0 ? (
            <p className="muted small">No imported samples in this period{measurementKey ? " (manual entries are listed under Body measurements)" : ""}.</p>
          ) : (
            <table>
              <thead><tr><th>App / device</th><th>Delivered by</th><th className="r">Samples</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.sourceName + s.source}><td>{s.sourceName}</td><td className="small muted">{s.source}</td><td className="r num">{s.samples.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Recent samples</h2>
          {samples.length === 0 ? (
            <p className="muted small">No raw samples in this period.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Time</th><th className="r">Value</th><th>Source</th></tr></thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.id}>
                      <td className="small">{formatDateTime(s.startMs, tz)}{s.endMs - s.startMs > 60_000 ? <span className="faint"> – {formatDateTime(s.endMs, tz).split(", ")[1]}</span> : null}</td>
                      <td className="r num">{def.aggregation === "sleep" ? `${s.category?.replace("asleep_", "")} · ${formatDuration((s.endMs - s.startMs) / 60_000)}` : formatMetricText(def, s.value, units)}</td>
                      <td className="small muted">{s.sourceName ?? s.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
