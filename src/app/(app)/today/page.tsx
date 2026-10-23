import Link from "next/link";
import { SleepChart } from "@/components/charts";
import { EmptyState, FlashMessage, PageHead } from "@/components/ui";
import { TodayTile } from "@/components/TodayTile";
import { getAllSourcesBreakdown, getLatestReading, getMetricSummary, getSleepNights, type MetricSummary } from "@/lib/aggregation/series";
import { getSyncStatus } from "@/lib/ingest/sync-status";
import { appContext, db } from "@/lib/server/context";
import { formatDate, formatDateTime, formatRelative, previousRange, rangeFromDays } from "@/lib/time";
import { listWorkouts } from "@/lib/training/repo";
import { formatDuration, formatNumber } from "@/lib/units";

export const metadata = { title: "Today" };

const ACTIVITY_METRICS = ["step_count", "active_energy", "exercise_time", "stand_hours", "flights_climbed"];
const HEART_METRICS = ["resting_heart_rate", "heart_rate_variability", "oxygen_saturation"];
const NUTRITION_METRICS = ["dietary_energy", "dietary_protein", "dietary_carbohydrates", "dietary_fat", "dietary_water"];

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const units = settings.units;

  // Always exactly today — day navigation belongs on the Dashboard / metric pages, which already have it.
  const range = rangeFromDays(1, tz);
  const prev = previousRange(range, tz);
  const status = getSyncStatus(database);

  const summaries = new Map<string, MetricSummary>();
  const summary = (key: string) => {
    if (!summaries.has(key)) summaries.set(key, getMetricSummary(database, key, range, prev, tz)!);
    return summaries.get(key)!;
  };

  const nights = getSleepNights(database, range, tz);
  const lastNight = nights[nights.length - 1] ?? null;
  const workouts = listWorkouts(database, range.startMs, range.endMs);
  const rightNowHr = getLatestReading(database, "heart_rate");
  const sources = getAllSourcesBreakdown(database, range);
  const hasAnything = sources.length > 0 || workouts.length > 0;

  return (
    <>
      <FlashMessage searchParams={sp} />
      <PageHead
        eyebrow={formatDate(range.from, tz)}
        title="Today"
        sub={
          <span className="small">
            Last successful Apple Health sync:{" "}
            {status.lastSuccessAt ? <strong title={formatDateTime(status.lastSuccessAt, tz)}>{formatRelative(status.lastSuccessAt)}</strong> : <strong>never</strong>}
            {" · totals below are "}today so far<Link href="/" className="small" style={{ marginLeft: 8 }}>Trends on the Dashboard →</Link>
          </span>
        }
      />

      {!hasAnything ? (
        <div className="card">
          <EmptyState title="Nothing synced for today yet">
            <p>Vigor fills this page from your Apple Health sync. Once today&rsquo;s first sync lands, steps, energy, heart rate and anything else you&rsquo;ve allowed will show up here.</p>
            <Link className="btn primary" href="/integrations/apple-health">Set up Apple Health sync</Link>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="card section" style={{ marginTop: 20 }}>
            <div className="card-head"><h2>Activity</h2></div>
            <div className="grid grid-auto">
              {ACTIVITY_METRICS.map((k) => (
                <TodayTile key={k} summary={summary(k)} units={units} />
              ))}
            </div>
          </section>

          <section className="card section">
            <div className="card-head"><h2>Heart & recovery</h2></div>
            <div className="grid grid-auto">
              {HEART_METRICS.map((k) => (
                <TodayTile key={k} summary={summary(k)} units={units} />
              ))}
              <div className="tile">
                <span className="label">Right now</span>
                {rightNowHr ? (
                  <>
                    <span className="value">{formatNumber(rightNowHr.value, 0)}<span className="unit">bpm</span></span>
                    <span className="meta">{formatRelative(rightNowHr.at)} · {rightNowHr.sourceName}</span>
                  </>
                ) : (
                  <span className="empty">No heart-rate reading today</span>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-2 section">
            <div className="card">
              <div className="card-head"><h2>Last night&rsquo;s sleep</h2><Link href="/metrics/sleep_analysis" className="small">History →</Link></div>
              {lastNight ? (
                <>
                  <div className="row" style={{ gap: 28, marginBottom: 10 }}>
                    <div className="tile"><span className="label">Asleep</span><span className="value">{formatDuration(lastNight.asleepMin)}</span></div>
                    {lastNight.inBedMin !== null && (
                      <div className="tile"><span className="label">In bed</span><span className="value">{formatDuration(lastNight.inBedMin)}</span></div>
                    )}
                    <div className="tile"><span className="label">Bedtime – wake</span><span className="value" style={{ fontSize: "1.1rem" }}>{formatDateTime(lastNight.startMs, tz).split(", ")[1]} – {formatDateTime(lastNight.endMs, tz).split(", ")[1]}</span></div>
                  </div>
                  <SleepChart data={[{ day: lastNight.day, ...lastNight.stages, awake: lastNight.awakeMin }]} height={160} />
                </>
              ) : (
                <p className="muted">No sleep recorded for last night yet. It usually syncs once you wake and open the Health app.</p>
              )}
            </div>

            <div className="card">
              <div className="card-head"><h2>Training today</h2><Link href="/training" className="small">All training →</Link></div>
              {workouts.length === 0 ? (
                <p className="muted">No workout logged today yet.</p>
              ) : (
                <table>
                  <tbody>
                    {workouts.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <Link href={`/training/workouts/${w.id}`}>{w.title ?? w.activityType ?? "Workout"}</Link>
                          <div className="tiny faint">{w.sourceName ?? w.source}</div>
                        </td>
                        <td className="small muted">{formatDateTime(w.startMs, tz).split(", ")[1]}</td>
                        <td className="r num small">{w.durationS ? formatDuration(w.durationS / 60) : "—"}</td>
                        {w.exerciseCount > 0 ? (
                          <td className="r num small muted">{w.setCount} sets</td>
                        ) : (
                          <td className="r num small muted">{w.energyKcal ?? w.linked?.energyKcal ? `${formatNumber((w.energyKcal ?? w.linked?.energyKcal)!, 0)} kcal` : ""}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="card section">
            <div className="card-head"><h2>Nutrition today</h2><Link href="/nutrition" className="small">Details →</Link></div>
            {NUTRITION_METRICS.every((k) => summary(k).value === null) ? (
              <p className="muted">Nothing logged yet today. Vigor shows nutrition that apps such as food trackers write to Apple Health.</p>
            ) : (
              <div className="grid grid-auto">
                {NUTRITION_METRICS.map((k) => (
                  <TodayTile key={k} summary={summary(k)} units={units} />
                ))}
              </div>
            )}
          </section>

          <section className="card section">
            <div className="card-head"><h2>Synced today</h2></div>
            {sources.length === 0 ? (
              <p className="muted small">Nothing from Apple Health yet today — only workouts, if any, above.</p>
            ) : (
              <table>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.sourceName + s.source}><td>{s.sourceName}</td><td className="r num small muted">{s.samples.toLocaleString()} samples</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}
