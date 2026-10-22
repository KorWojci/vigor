import Link from "next/link";
import { notFound } from "next/navigation";
import { EnergyMinuteBars, WorkoutHrChart } from "@/components/charts";
import { PageHead } from "@/components/ui";
import { appContext, db } from "@/lib/server/context";
import { cardioDetail, maxHeartRate, workoutWindowSamples } from "@/lib/training/cardio";
import { getWorkout, listWorkouts } from "@/lib/training/repo";
import { formatDateTime } from "@/lib/time";
import { formatDuration, formatNumber, toDisplay } from "@/lib/units";

/** "5:42" from seconds. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60) % 60).padStart(2, "0")}`;

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { settings, tz } = await appContext();
  const { id } = await params;
  const database = db();
  const w = getWorkout(database, Number(id));
  if (!w) notFound();
  const linked = w.source === "hevy" ? listWorkouts(database, w.startMs - 1, w.startMs + 1).find((x) => x.id === w.id)?.linked : null;
  const mu = settings.units === "imperial" ? "lb" : "kg";
  const m = (kg: number) => formatNumber(toDisplay(kg, "kg", settings.units).value, 1);
  const energy = w.energyKcal ?? linked?.energyKcal ?? null;
  const hr = w.avgHr ?? linked?.avgHr ?? null;

  // Heart rate, splits and energy come from the samples recorded during the workout.
  const endMs = w.endMs ?? (w.durationS ? w.startMs + w.durationS * 1000 : null);
  const imperial = settings.units === "imperial";
  const splitM = imperial ? 1609.344 : 1000;
  const splitUnit = imperial ? "mi" : "km";
  const maxHr = maxHeartRate(database, settings.profile);
  const cardio = endMs ? cardioDetail(workoutWindowSamples(database, w.startMs, endMs), w.startMs, endMs, { maxHr: maxHr?.bpm ?? null, splitM, distanceM: w.distanceM }) : null;
  const peakHr = w.maxHr ?? cardio?.hrMax ?? null;
  const isRide = /cycl|bik/i.test(w.activityType ?? "");
  const paceOrSpeed = w.distanceM && w.durationS
    ? isRide
      ? `${formatNumber((w.distanceM / splitM) / (w.durationS / 3600), 1)} ${imperial ? "mph" : "km/h"}`
      : `${clock(w.durationS / (w.distanceM / splitM))} /${splitUnit}`
    : null;
  const fullSplits = cardio?.splits.filter((x) => x.distanceM >= splitM * 0.99) ?? [];
  const fastestPace = fullSplits.length ? Math.min(...fullSplits.map((x) => x.durationS / (x.distanceM / splitM))) : null;
  const zoneTotal = cardio?.zones?.reduce((a, z) => a + z.seconds, 0) ?? 0;
  const hasCardio = !!cardio && (cardio.hr.length > 0 || cardio.splits.length > 0 || cardio.energyPerMinute.length > 0);

  return (
    <>
      <PageHead eyebrow={w.sourceName ?? w.source} title={w.title ?? w.activityType ?? "Workout"} sub={formatDateTime(w.startMs, tz)}>
        <Link href="/training" className="btn small">← Training</Link>
      </PageHead>
      <section className="grid grid-4">
        <div className="card tile"><span className="label">Duration</span><span className="value">{w.durationS ? formatDuration(w.durationS / 60) : "—"}</span></div>
        <div className="card tile"><span className="label">Energy</span><span className="value">{energy !== null ? formatNumber(energy, 0) : "—"}<span className="unit">{energy !== null ? "kcal" : ""}</span></span><span className="meta">{w.energyKcal === null && linked?.energyKcal ? `from ${linked.sourceName ?? "Apple Health"}` : energy === null ? "not recorded" : ""}</span></div>
        <div className="card tile"><span className="label">Avg heart rate</span><span className="value">{hr !== null ? formatNumber(hr, 0) : "—"}<span className="unit">{hr !== null ? "bpm" : ""}</span></span><span className="meta">{hr === null ? "not recorded" : peakHr !== null ? `max ${formatNumber(peakHr, 0)} bpm` : ""}</span></div>
        <div className="card tile">
          {w.exerciseCount > 0 ? (
            <><span className="label">Volume</span><span className="value">{m(w.volumeKg)}<span className="unit">{mu}</span></span><span className="meta">{w.setCount} working sets</span></>
          ) : (
            <><span className="label">Distance</span><span className="value">{w.distanceM ? formatNumber(toDisplay(w.distanceM, "m", settings.units).value, 2) : "—"}<span className="unit">{w.distanceM ? toDisplay(w.distanceM, "m", settings.units).unit : ""}</span></span>{paceOrSpeed && <span className="meta">{isRide ? "avg speed" : "avg pace"} {paceOrSpeed}</span>}</>
          )}
        </div>
      </section>
      {w.notes && <p className="section muted">{w.notes}</p>}
      {cardio && cardio.hr.length > 0 && (
        <section className="grid grid-2 section">
          <div className="card">
            <div className="card-head"><h2>Heart rate</h2><span className="small muted">{cardio.hrSource ?? ""}</span></div>
            <WorkoutHrChart data={cardio.hr} zoneBounds={cardio.zones?.map((z) => z.fromBpm)} />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Heart-rate zones</h2>
              {maxHr && (
                <span className="small muted">
                  max {maxHr.bpm} bpm · {maxHr.basis === "profile" ? "from profile" : maxHr.basis === "age" ? "220 − age" : "highest reading, 12 months"} · <Link href="/settings?tab=profile">change</Link>
                </span>
              )}
            </div>
            {cardio.zones ? (
              <table>
                <thead><tr><th>Zone</th><th>Range</th><th className="r">Time</th><th style={{ width: "40%" }}></th></tr></thead>
                <tbody>
                  {[...cardio.zones].reverse().map((z) => {
                    const pct = zoneTotal ? (z.seconds / zoneTotal) * 100 : 0;
                    return (
                      <tr key={z.zone}>
                        <td>Z{z.zone} <span className="small muted">{z.label}</span></td>
                        <td className="small num">{z.zone === 1 ? `< ${z.toBpm}` : z.toBpm ? `${z.fromBpm}–${z.toBpm - 1}` : `≥ ${z.fromBpm}`}</td>
                        <td className="r num small">{clock(z.seconds)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ height: 8, width: `${pct}%`, minWidth: pct > 0 ? 2 : 0, background: "var(--chart-1)", borderRadius: 4 }} />
                            <span className="tiny faint num">{formatNumber(pct, 0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="muted">Set your max heart rate in Settings → Profile to see zones.</p>}
          </div>
        </section>
      )}
      {cardio && cardio.splits.length > 0 && (
        <section className="card section">
          <div className="card-head"><h2>Splits</h2><span className="small muted">per {splitUnit} · {cardio.distanceSource ?? ""}</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{splitUnit.toUpperCase()}</th><th className="r">Distance</th><th className="r">Time</th><th className="r">Pace</th><th className="r">Avg HR</th><th className="r">Energy</th></tr></thead>
              <tbody>
                {cardio.splits.map((sp) => {
                  const pace = sp.durationS / (sp.distanceM / splitM);
                  return (
                    <tr key={sp.index}>
                      <td>{sp.index}</td>
                      <td className="r num small">{formatNumber(sp.distanceM / splitM, 2)} {splitUnit}</td>
                      <td className="r num">{clock(sp.durationS)}</td>
                      <td className="r num">{isRide ? `${formatNumber((sp.distanceM / splitM) / (sp.durationS / 3600), 1)} ${imperial ? "mph" : "km/h"}` : `${clock(pace)} /${splitUnit}`}{sp.distanceM >= splitM * 0.99 && pace === fastestPace && cardio.splits.length > 1 ? " ★" : ""}</td>
                      <td className="r num small">{sp.avgHr !== null ? `${formatNumber(sp.avgHr, 0)} bpm` : "—"}</td>
                      <td className="r num small">{sp.energyKcal !== null ? `${formatNumber(sp.energyKcal, 0)} kcal` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 8 }}>★ fastest full split. Split times are interpolated from the distance readings recorded during the workout, so they can differ by a few seconds from the Fitness app.</p>
        </section>
      )}
      {cardio && cardio.energyPerMinute.length > 0 && (
        <section className="card section">
          <div className="card-head"><h2>Active energy per minute</h2></div>
          <EnergyMinuteBars data={cardio.energyPerMinute} />
        </section>
      )}
      {w.exerciseCount === 0 ? (
        <div className="card section">
          <p className="muted small">
            {hasCardio
              ? "Heart rate, splits and energy are built from the Apple Health samples recorded during this workout. Route, elevation and running form are not synced yet."
              : "This workout came from Apple Health, which records a summary (type, duration, energy, distance, heart rate) but not exercises, sets or weights. No heart-rate or distance samples were found for its time window."}
          </p>
        </div>
      ) : (
        <section className="grid grid-2 section">
          {w.exercises.map((e) => (
            <div key={e.id} className="card">
              <div className="card-head">
                <h3><Link href={`/training/exercises/${e.exerciseId}`}>{e.name}</Link></h3>
                {e.stats.bestE1RM ? <span className="small muted">e1RM {m(e.stats.bestE1RM)} {mu}</span> : null}
              </div>
              <table>
                <thead><tr><th>#</th><th>Type</th><th className="r">Weight</th><th className="r">Reps</th><th className="r">Time / distance</th></tr></thead>
                <tbody>
                  {e.sets.map((s, i) => (
                    <tr key={s.id} className={s.setType === "warmup" ? "faint" : undefined}>
                      <td>{i + 1}</td>
                      <td className="small">{s.setType}</td>
                      <td className="r num">{s.weightKg !== null ? `${m(s.weightKg)} ${mu}` : "—"}</td>
                      <td className="r num">{s.reps ?? "—"}</td>
                      <td className="r num small">{s.durationS ? formatDuration(s.durationS / 60) : s.distanceM ? `${formatNumber(s.distanceM, 0)} m` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {e.notes && <p className="small muted" style={{ marginTop: 8 }}>{e.notes}</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
