import Link from "next/link";
import { WeeklyBars } from "@/components/charts";
import { EmptyState, PageHead, RangeSelector } from "@/components/ui";
import { appContext, db } from "@/lib/server/context";
import { EXERCISE_KINDS } from "@/lib/training/calculations";
import { listExercises, listWorkouts, workoutsPerWeek } from "@/lib/training/repo";
import type { WeekBar } from "@/components/charts";
import { addDays, formatDate, formatDateTime, isoWeek, presetDays, rangeFromDays, weekStart } from "@/lib/time";
import { formatDuration, formatNumber, toDisplay } from "@/lib/units";

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
