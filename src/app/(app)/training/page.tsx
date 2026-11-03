import Link from "next/link";
import { WeeklyBars } from "@/components/charts";
import { EmptyState, PageHead, RangeSelector } from "@/components/ui";
import { appContext, db } from "@/lib/server/context";
import { EXERCISE_KINDS } from "@/lib/training/calculations";
import { predictRaceTimes, type Confidence } from "@/lib/training/race-predict";
import { listExercises, listRunningEfforts, listWorkouts, workoutsPerWeek } from "@/lib/training/repo";
import type { WeekBar } from "@/components/charts";
import { addDays, formatDate, formatDateTime, isoWeek, presetDays, rangeFromDays, weekStart } from "@/lib/time";
import { formatDuration, formatNumber, toDisplay } from "@/lib/units";
import { getWeeklyRecap } from "@/lib/ai/repo";
import { config } from "@/lib/config";
import { WeeklyRecapCard } from "@/components/WeeklyRecapCard";

export const metadata = { title: "Training" };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const preset = presetDays(sp.range ?? "90d");
  const range = rangeFromDays(preset.days, tz);
  const workouts = listWorkouts(database, range.startMs, range.endMs);
  const exercises = listExercises(database).filter((e) => e.sessions > 0);
  const massUnit = settings.units === "imperial" ? "lb" : "kg";

  // Consistency: every week in range, including empty weeks (shown as 0 workouts — a count, not a measurement).
  const perWeek = new Map(workoutsPerWeek(workouts, (ms) => weekStart(ms, tz)).map((w) => [w.week, w.count]));
  const weeks: WeekBar[] = [];
  for (let w = weekStart(range.startMs, tz); w <= range.to; w = addDays(w, 7)) {
    const { year, week } = isoWeek(w);
    const selected = sp.week === w;
    const href = `/training?${new URLSearchParams({ range: preset.key, ...(selected ? {} : { week: w }) })}`;
    weeks.push({ week: w, label: `W${week}`, title: `Week ${week}, ${year}`, dates: `${formatDate(w, tz)} – ${formatDate(addDays(w, 6), tz)}`, count: perWeek.get(w) ?? 0, href });
  }
  const activeWeeks = weeks.filter((w) => w.count > 0).length;
  // Clicking a bar (?week=Monday) narrows the workout list to that week; clicking it again clears it.
  const selectedWeek = weeks.find((w) => w.week === sp.week);
  const listed = selectedWeek ? workouts.filter((w) => weekStart(w.startMs, tz) === selectedWeek.week) : workouts;
  const totalVolume = workouts.reduce((a, w) => a + w.volumeKg, 0);
  const totalDuration = workouts.reduce((a, w) => a + (w.durationS ?? 0), 0);
  const lastWeekStartDay = addDays(weekStart(Date.now(), tz), -7);
  // Follows the week the user is actually looking at (clicking a bar in "Workouts per week"
  // narrows to that week); defaults to last calendar week when nothing is selected.
  const recapWeekStart = selectedWeek?.week ?? lastWeekStartDay;
  const recap = getWeeklyRecap(database, recapWeekStart, "training");
  const recapReturnTo = `/training?${new URLSearchParams({ range: preset.key, ...(selectedWeek ? { week: selectedWeek.week } : {}) })}`;

  // A fixed lookback for predictions, independent of the page's own range selector — "predict my
  // race time" means "from my recent fitness", not "from whatever window I happen to be browsing".
  const PREDICTION_LOOKBACK_DAYS = 180;
  const predictions = predictRaceTimes(listRunningEfforts(database, Date.now() - PREDICTION_LOOKBACK_DAYS * 86_400_000));
  const hasPredictions = predictions.some((p) => p.predictedS !== null);
  const CONFIDENCE_PILL: Record<Confidence, string> = { high: "ok", medium: "stale", low: "failing" };
  const distUnit = settings.units === "imperial" ? "mi" : "km";
  const distDisplay = (m: number) => (settings.units === "imperial" ? m / 1609.344 : m / 1000);
  const clock = (totalSeconds: number) => {
    const s = Math.round(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <>
      <PageHead title="Training" sub="Workouts from Hevy exports and Apple Health, with exercise-level progress.">
        <RangeSelector current={preset.key} basePath="/training" />
      </PageHead>

      {workouts.length === 0 && exercises.length === 0 ? (
        <div className="card">
          <EmptyState title="No workouts yet">
            <p>Import your Hevy workout export to see exercises, sets and personal records. Apple Health workouts arrive with the health sync.</p>
            <Link className="btn primary" href="/settings?tab=training">Import a Hevy export</Link>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="grid grid-4">
            <div className="card tile"><span className="label">Workouts</span><span className="value">{workouts.length}</span><span className="meta">in {range.days} days</span></div>
            <div className="card tile"><span className="label">Consistency</span><span className="value">{activeWeeks}<span className="unit">/ {weeks.length} weeks</span></span><span className="meta">weeks with at least one workout</span></div>
            <div className="card tile"><span className="label">Lifting volume</span><span className="value">{formatNumber(toDisplay(totalVolume, "kg", settings.units).value, 0)}<span className="unit">{massUnit}</span></span><span className="meta">weight × reps, working sets</span></div>
            <div className="card tile"><span className="label">Time training</span><span className="value">{formatDuration(totalDuration / 60)}</span><span className="meta">{formatNumber((workouts.length / range.days) * 7, 1)} sessions / week</span></div>
          </section>

          <section className="card section">
            <div className="card-head"><h2>Workouts per week</h2><span className="small muted">ISO weeks · click a bar to list its workouts</span></div>
            <WeeklyBars data={weeks} selected={selectedWeek?.week} height={200} />
          </section>

          <WeeklyRecapCard
            recap={recap}
            scope="training"
            title="Training recap"
            weekLabel={selectedWeek ? `${selectedWeek.title} · ${selectedWeek.dates}` : `Last week · ${formatDate(lastWeekStartDay, tz)} – ${formatDate(addDays(lastWeekStartDay, 6), tz)}`}
            weekStart={recapWeekStart}
            returnTo={recapReturnTo}
            hasApiKey={!!config.geminiApiKey}
          />

          {hasPredictions && (
            <section className="card section">
              <div className="card-head"><h2>Race time predictions</h2><span className="small muted">From running workouts in the last {PREDICTION_LOOKBACK_DAYS} days</span></div>
              <div className="grid grid-4">
                {predictions.map((p) => (
                  <div className="card tile" key={p.distance.key}>
                    <span className="label">{p.distance.label}</span>
                    {p.predictedS !== null ? (
                      <>
                        <span className="value">{clock(p.predictedS)}</span>
                        <span className="meta">{clock(p.predictedS / distDisplay(p.distance.meters))} / {distUnit}</span>
                        <span className={`pill ${CONFIDENCE_PILL[p.confidence!]}`} style={{ marginTop: 6 }}><span className="dot" />{p.confidence} confidence</span>
                      </>
                    ) : (
                      <span className="empty">Not enough data</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="tiny faint" style={{ marginTop: 10 }}>
                Estimated with the Riegel formula from whichever qualifying run (≥1 km) implies the fastest time at each distance — your best demonstrated
                fitness, not a guarantee. Confidence reflects how close that run&apos;s own distance is to the target: extrapolating a marathon time from a 5K is a much bigger guess than from
                a half marathon.
              </p>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Distance</th><th>Based on</th><th className="r">Run distance</th><th>When</th></tr></thead>
                  <tbody>
                    {predictions.filter((p) => p.basedOn).map((p) => (
                      <tr key={p.distance.key}>
                        <td>{p.distance.label}</td>
                        <td><Link href={`/training/workouts/${p.basedOn!.workoutId}`} className="small">View workout →</Link></td>
                        <td className="r num small">{formatNumber(distDisplay(p.basedOn!.distanceM), 2)} {distUnit}</td>
                        <td className="small muted">{formatDate(p.basedOn!.startMs, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="grid grid-2 section">
            <div className="card">
              <div className="card-head"><h2>Exercises</h2><span className="small muted">{exercises.length} tracked</span></div>
              <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>Exercise</th><th>Type</th><th className="r">Sessions</th><th>Last</th></tr></thead>
                  <tbody>
                    {exercises.map((e) => (
                      <tr key={e.id}>
                        <td><Link href={`/training/exercises/${e.id}`}>{e.name}</Link></td>
                        <td className="small muted">{EXERCISE_KINDS.find((k) => k.key === e.kind)?.label}</td>
                        <td className="r num">{e.sessions}</td>
                        <td className="small muted">{e.lastMs ? formatDate(e.lastMs, tz) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              {selectedWeek ? (
                <div className="card-head">
                  <h2>Workouts · {selectedWeek.title}</h2>
                  <Link href={`/training?${new URLSearchParams({ range: preset.key })}`} scroll={false} className="small">Show all →</Link>
                </div>
              ) : (
                <div className="card-head"><h2>Workouts</h2><Link href="/settings?tab=training" className="small">Import Hevy export →</Link></div>
              )}
              {selectedWeek && <p className="small muted" style={{ marginTop: 0 }}>{selectedWeek.dates}</p>}
              {listed.length === 0 ? <p className="muted">{selectedWeek ? "No workouts in this week." : "No workouts in this period."}</p> : (
                <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
                  <table>
                    <thead><tr><th>Workout</th><th>Date</th><th className="r">Sets</th><th className="r">Duration</th></tr></thead>
                    <tbody>
                      {listed.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/training/workouts/${w.id}`}>{w.title ?? w.activityType ?? "Workout"}</Link>
                            <div className="tiny faint">
                              {w.sourceName ?? w.source}
                              {w.linked ? ` + ${w.linked.sourceName ?? "Apple Health"}` : ""}
                              {w.energyKcal ?? w.linked?.energyKcal ? ` · ${formatNumber((w.energyKcal ?? w.linked?.energyKcal)!, 0)} kcal` : ""}
                            </div>
                          </td>
                          <td className="small muted">{formatDateTime(w.startMs, tz)}</td>
                          <td className="r num">{w.setCount || "—"}</td>
                          <td className="r num small">{w.durationS ? formatDuration(w.durationS / 60) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="tiny faint" style={{ marginTop: 8 }}>
                Apple Health workouts recorded at the same time as a Hevy workout are merged into it (energy and heart rate come from Apple Health; sets from Hevy).
              </p>
            </div>
          </section>
        </>
      )}
    </>
  );
}
