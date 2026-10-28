import type { ReactNode } from "react";
import Link from "next/link";
import { SleepChart } from "@/components/charts";
import { MuscleFigure } from "@/components/MuscleFigure";
import { EmptyState, FlashMessage, PageHead } from "@/components/ui";
import { TodayEditor } from "@/components/TodayEditor";
import { TodayTile } from "@/components/TodayTile";
import { getAllSourcesBreakdown, getLatestReading, getMetricSummary, getSleepNights, type MetricSummary } from "@/lib/aggregation/series";
import { getSyncStatus } from "@/lib/ingest/sync-status";
import { appContext, db } from "@/lib/server/context";
import { getTodayLayout } from "@/lib/settings";
import { formatDate, formatDateTime, formatRelative, previousRange, rangeFromDays } from "@/lib/time";
import { listExerciseMedia } from "@/lib/training/exercise-media";
import { addActivityLoad, addExerciseLoad, isAssumedActivity, normalizeLoad, type ZoneLoad } from "@/lib/training/muscles";
import { getWorkout, listWorkouts } from "@/lib/training/repo";
import { formatDuration, formatNumber } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";

export const metadata = { title: "Today" };

/** Visible tiles, then a "Show more" toggle for the rest — order and split configured in Customize Today. */
function MetricSection({ visible, more, summary, units, extra }: { visible: string[]; more: string[]; summary: (k: string) => MetricSummary; units: UnitSystem; extra?: ReactNode }) {
  return (
    <>
      <div className="grid grid-4">
        {visible.map((k) => <TodayTile key={k} summary={summary(k)} units={units} />)}
        {extra}
      </div>
      {more.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small" style={{ cursor: "pointer" }}>Show {more.length} more</summary>
          <div className="grid grid-4" style={{ marginTop: 10 }}>
            {more.map((k) => <TodayTile key={k} summary={summary(k)} units={units} />)}
          </div>
        </details>
      )}
    </>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const units = settings.units;
  const edit = sp.edit === "1";

  // Always exactly today — day navigation belongs on the Dashboard / metric pages, which already have it.
  const range = rangeFromDays(1, tz);
  const prev = previousRange(range, tz);
  const status = getSyncStatus(database);
  const layout = getTodayLayout(database);

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

  const muscleRaw: ZoneLoad = {};
  let assumedMuscleLoad = false;
  for (const w of workouts) {
    if (w.exerciseCount > 0) {
      const full = getWorkout(database, w.id);
      if (!full) continue;
      const mediaByExercise = listExerciseMedia(database, full.exercises.map((e) => e.exerciseId));
      for (const e of full.exercises) {
        const media = mediaByExercise.get(e.exerciseId);
        addExerciseLoad(muscleRaw, { workingSets: e.stats.workingSets, targetMuscles: media?.targetMuscles ?? [], secondaryMuscles: media?.secondaryMuscles ?? [] });
      }
    } else if (w.activityType && w.durationS) {
      addActivityLoad(muscleRaw, w.activityType, w.durationS);
      if (isAssumedActivity(w.activityType)) assumedMuscleLoad = true;
    }
  }
  const muscleLoad = normalizeLoad(muscleRaw);

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
      >
        {edit ? null : <Link className="btn small" href="/today?edit=1">Customize</Link>}
      </PageHead>

      {edit ? (
        <TodayEditor initial={layout} />
      ) : !hasAnything ? (
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
            <MetricSection visible={layout.activity.visible} more={layout.activity.more} summary={summary} units={units} />
          </section>

          <section className="card section">
            <div className="card-head"><h2>Heart & recovery</h2></div>
            <MetricSection
              visible={layout.heart.visible}
              more={layout.heart.more}
              summary={summary}
              units={units}
              extra={
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
              }
            />
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

          {Object.keys(muscleLoad).length > 0 && (
            <section className="card section">
              <h2>Muscle load today</h2>
              <MuscleFigure intensities={muscleLoad} />
              <p className="tiny faint" style={{ marginTop: 8 }}>
                Across all of today&rsquo;s training. Strength numbers come from logged sets and target muscles
                {assumedMuscleLoad ? "; non-strength activities (a run, walk, yoga session, etc.) have load assumed from the activity type and duration" : ""} — not a measurement.
              </p>
            </section>
          )}

          <section className="card section">
            <div className="card-head"><h2>Nutrition today</h2><Link href="/nutrition" className="small">Details →</Link></div>
            {[...layout.nutrition.visible, ...layout.nutrition.more].every((k) => summary(k).value === null) ? (
              <p className="muted">Nothing logged yet today. Vigor shows nutrition that apps such as food trackers write to Apple Health.</p>
            ) : (
              <MetricSection visible={layout.nutrition.visible} more={layout.nutrition.more} summary={summary} units={units} />
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

          <p className="tiny faint section">
            Use <Link href="/today?edit=1">Customize</Link> to change which metrics are always visible, which are under “Show more”, and their order.
          </p>
        </>
      )}
    </>
  );
}
