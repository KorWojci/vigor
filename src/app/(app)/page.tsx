import Link from "next/link";
import { MetricTile } from "@/components/MetricTile";
import { VitruvianFigure, type RegionDatum } from "@/components/VitruvianFigure";
import { PageHead, RangeSelector, Notice, Delta } from "@/components/ui";
import { SleepChart, TrendChart } from "@/components/charts";
import { getMetricSummary, getSleepNights, getLatestReading, type MetricSummary } from "@/lib/aggregation/series";
import { latestMeasurements, listMeasurementTypes } from "@/lib/body/repo";
import { CANONICAL_UNIT } from "@/lib/body/repo";
import { formatMetric, formatMetricText, trendOf } from "@/lib/format";
import { getMetric } from "@/lib/metrics/catalog";
import { getSyncStatus } from "@/lib/ingest/sync-status";
import { appContext, db } from "@/lib/server/context";
import { DASHBOARD_TILES } from "@/lib/settings";
import { formatDate, formatDateTime, formatRelative, presetDays, previousRange, rangeFromDays } from "@/lib/time";
import { listWorkouts } from "@/lib/training/repo";
import { formatDuration, formatNumber, toDisplay } from "@/lib/units";

export const metadata = { title: "Dashboard" };

const TILE_METRIC: Record<string, string> = {
  weight: "body_mass",
  body_fat: "body_fat_percentage",
  steps: "step_count",
  active_energy: "active_energy",
  exercise: "exercise_time",
  sleep: "sleep_analysis",
  resting_hr: "resting_heart_rate",
  hrv: "heart_rate_variability",
  vo2max: "vo2_max",
  spo2: "oxygen_saturation",
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const units = settings.units;
  const preset = presetDays(sp.range, settings.defaultRange as never);
  const range = rangeFromDays(preset.days, tz);
  const prev = previousRange(range, tz);
  const status = getSyncStatus(database);

  const summaries = new Map<string, MetricSummary>();
  const summary = (metric: string) => {
    if (!summaries.has(metric)) summaries.set(metric, getMetricSummary(database, metric, range, prev, tz)!);
    return summaries.get(metric)!;
  };

  // Figure regions: manual body measurements, plus sleep (head), resting heart rate (heart), weight (body).
  const types = listMeasurementTypes(database);
  const latest = latestMeasurements(database);
  const regions: RegionDatum[] = [];
  const regionLabels: Record<string, string> = {
    neck: "Neck", shoulders: "Shoulders", chest: "Chest", waist: "Waist", hips: "Hips",
    upper_arm_left: "L. upper arm", upper_arm_right: "R. upper arm", forearm_left: "L. forearm", forearm_right: "R. forearm",
    thigh_left: "L. thigh", thigh_right: "R. thigh", calf_left: "L. calf", calf_right: "R. calf",
  };
  for (const t of types) {
    if (!t.region || t.region === "body" || !t.builtin) continue;
    const l = latest.get(t.key);
    const d = l ? toDisplay(l.latest.value, CANONICAL_UNIT[t.dimension], units) : null;
    regions.push({
      region: t.region as RegionDatum["region"],
      label: regionLabels[t.key] ?? t.label,
      value: d ? `${formatNumber(d.value, 1)} ${d.unit}` : null,
      href: `/body?type=${t.key}`,
      title: l ? `${t.label}: ${formatNumber(d!.value, 1)} ${d!.unit} on ${formatDate(l.latest.measuredAt, tz)}` : `${t.label}: no measurement yet — click to add`,
    });
  }
  const sleep = summary("sleep_analysis");
  regions.push({ region: "head", label: "Sleep", value: sleep.value !== null ? formatMetricText("sleep_analysis", sleep.value, units) : null, href: "/metrics/sleep_analysis", title: "Average sleep per night in the selected period" });
  const rhr = getLatestReading(database, "resting_heart_rate");
  regions.push({ region: "heart", label: "Resting HR", value: rhr ? formatMetricText("resting_heart_rate", rhr.value, units) : null, href: "/metrics/resting_heart_rate", title: rhr ? `Latest resting heart rate, ${formatDate(rhr.at, tz)} (${rhr.sourceName})` : "No resting heart rate data" });
  const weight = getLatestReading(database, "body_mass");
  regions.push({ region: "body", label: "Weight", value: weight ? formatMetricText("body_mass", weight.value, units) : null, href: "/metrics/body_mass", title: weight ? `Latest weight, ${formatDate(weight.at, tz)} (${weight.sourceName})` : "No weight recorded — click to add" });

  const tiles = settings.dashboardTiles.filter((k) => DASHBOARD_TILES.some((t) => t.key === k));
  const metricTiles = tiles.filter((k) => TILE_METRIC[k]);
  const left = metricTiles.filter((_, i) => i % 2 === 0).slice(0, 4);
  const right = metricTiles.filter((_, i) => i % 2 === 1).slice(0, 4);
  const rest = metricTiles.filter((k) => !left.includes(k) && !right.includes(k));

  const workouts = listWorkouts(database, range.startMs, range.endMs);
  const prevWorkouts = listWorkouts(database, prev.startMs, prev.endMs);
  const nights = getSleepNights(database, range, tz);
  const weightSummary = summary("body_mass");

  const nutritionKeys = ["dietary_energy", "dietary_protein", "dietary_carbohydrates", "dietary_fat"];
  const nutrition = nutritionKeys.map((k) => summary(k));

  const tile = (k: string) => (
    <MetricTile key={k} summary={summary(TILE_METRIC[k])} units={units} tz={tz} rangeDays={range.days} label={DASHBOARD_TILES.find((t) => t.key === k)?.label} />
  );

  const demo = database.prepare("SELECT 1 FROM health_samples WHERE source = 'demo' LIMIT 1").get();

  return (
    <>
      <PageHead
        eyebrow={`${formatDate(range.from, tz)} – ${formatDate(range.to, tz)}`}
        title={settings.profile.displayName ? `Good to see you, ${settings.profile.displayName}` : "Your condition at a glance"}
        sub={
          <span className="small">
            Last successful Apple Health sync:{" "}
            {status.lastSuccessAt ? <strong title={formatDateTime(status.lastSuccessAt, tz)}>{formatRelative(status.lastSuccessAt)}</strong> : <strong>never</strong>}
            {" · "}target interval {settings.syncIntervalMinutes} min
          </span>
        }
      >
        <RangeSelector current={preset.key} basePath="/" />
      </PageHead>

      {demo && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn"><p><strong>Demonstration data is loaded.</strong> Some values on this page are synthetic (source “demo”). Remove them in Settings → Data.</p></Notice>
        </div>
      )}
      {status.state === "stale" && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn"><p>No Apple Health data has arrived for more than {status.staleAfterHours} hours, so recent values may be outdated. <Link href="/integrations/apple-health">Check the sync status</Link>.</p></Notice>
        </div>
      )}
      {status.state === "failing" && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="error"><p>Recent Apple Health syncs failed{status.lastError ? `: ${status.lastError}` : ""}. <Link href="/integrations/apple-health">Troubleshoot</Link>.</p></Notice>
        </div>
      )}

      <section className="hero">
        <div className="hero-col">{left.map(tile)}</div>
        <div className="figure-wrap card" style={{ padding: 8 }}>
          <VitruvianFigure regions={regions} heartRate={rhr?.value} />
          <p className="tiny faint" style={{ textAlign: "center", margin: "0 0 6px" }}>
            Select a marker to open its history · dashed markers have no data yet
          </p>
        </div>
        <div className="hero-col">{right.map(tile)}</div>
      </section>

      {rest.length > 0 && <section className="grid grid-4 section">{rest.map(tile)}</section>}

      <section className="grid grid-2 section">
        {tiles.includes("training") && (
          <div className="card">
            <div className="card-head">
              <h2>Training</h2>
              <Link href="/training" className="small">All training →</Link>
            </div>
            {workouts.length === 0 ? (
              <p className="muted">No workouts recorded in this period. Import a Hevy export or sync Apple Health workouts.</p>
            ) : (
              <>
                <div className="row" style={{ gap: 28, marginBottom: 12 }}>
                  <div className="tile"><span className="label">Workouts</span><span className="value">{workouts.length}</span>
                    <Delta trend={prevWorkouts.length ? { pct: ((workouts.length - prevWorkouts.length) / prevWorkouts.length) * 100, direction: workouts.length > prevWorkouts.length ? "up" : workouts.length < prevWorkouts.length ? "down" : "flat", tone: workouts.length >= prevWorkouts.length ? "good" : "bad" } : null} />
                  </div>
                  <div className="tile"><span className="label">Per week</span><span className="value">{formatNumber((workouts.length / range.days) * 7, 1)}</span></div>
                  <div className="tile"><span className="label">Volume</span><span className="value">{formatNumber(toDisplay(workouts.reduce((a, w) => a + w.volumeKg, 0), "kg", units).value, 0)}<span className="unit">{units === "imperial" ? "lb" : "kg"}</span></span></div>
                </div>
                <table>
                  <tbody>
                    {workouts.slice(0, 5).map((w) => (
                      <tr key={w.id}>
                        <td><Link href={`/training/workouts/${w.id}`}>{w.title ?? w.activityType ?? "Workout"}</Link><div className="tiny faint">{w.sourceName ?? w.source}</div></td>
                        <td className="small muted">{formatDateTime(w.startMs, tz)}</td>
                        <td className="r small">{w.durationS ? formatDuration(w.durationS / 60) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <h2>Body weight</h2>
            <Link href="/metrics/body_mass" className="small">History →</Link>
          </div>
          {weightSummary.daily.length ? (
            <TrendChart data={weightSummary.daily.map((d) => ({ day: d.day, value: toDisplay(d.value, "kg", units).value }))} unit={units === "imperial" ? "lb" : "kg"} chart="line" decimals={1} height={230} label="Weight" />
          ) : (
            <p className="muted">No weight readings in this period. <Link href="/body?type=weight">Add a measurement</Link> or sync Apple Health.</p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Sleep</h2>
            <Link href="/metrics/sleep_analysis" className="small">Details →</Link>
          </div>
          {nights.length ? (
            <SleepChart data={nights.map((n) => ({ day: n.day, ...n.stages, awake: n.awakeMin }))} height={230} />
          ) : (
            <p className="muted">No sleep data in this period. Sleep requires Sleep Analysis permission for the sync source.</p>
          )}
        </div>
        {tiles.includes("nutrition") && (
          <div className="card">
            <div className="card-head">
              <h2>Nutrition</h2>
              <Link href="/nutrition" className="small">Details →</Link>
            </div>
            {nutrition.every((n) => n.value === null) ? (
              <p className="muted">
                No nutrition records in this period. Vigor shows nutrition that apps such as food trackers write to Apple Health — check that your
                nutrition app shares with Health and that the sync includes dietary types.
              </p>
            ) : (
              <div className="grid grid-2">
                {nutrition.map((n) => {
                  const f = formatMetric(n.def, n.value, units);
                  const def = getMetric(n.def.key)!;
                  return (
                    <Link key={n.def.key} href={`/metrics/${n.def.key}`} className="tile" style={{ color: "inherit" }}>
                      <span className="label">{n.def.label}</span>
                      <span className="value" style={{ fontSize: "1.5rem" }}>{f.value}<span className="unit">{f.unit}</span></span>
                      <span className="meta">{n.value === null ? "no data" : `daily avg · ${n.daysWithData} days logged`}</span>
                      {n.value !== null && <Delta trend={trendOf(def, n.value, n.previous)} />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
      <p className="tiny faint section">
        Dashboard tiles can be chosen in <Link href="/settings?tab=metrics">Settings → Metrics</Link>. Values are never inferred: a dash means no data was recorded.
      </p>
    </>
  );
}
