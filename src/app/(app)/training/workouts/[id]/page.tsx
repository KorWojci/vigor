import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui";
import { appContext, db } from "@/lib/server/context";
import { getWorkout, listWorkouts } from "@/lib/training/repo";
import { formatDateTime } from "@/lib/time";
import { formatDuration, formatNumber, toDisplay } from "@/lib/units";

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

  return (
    <>
      <PageHead eyebrow={w.sourceName ?? w.source} title={w.title ?? w.activityType ?? "Workout"} sub={formatDateTime(w.startMs, tz)}>
        <Link href="/training" className="btn small">← Training</Link>
      </PageHead>
      <section className="grid grid-4">
        <div className="card tile"><span className="label">Duration</span><span className="value">{w.durationS ? formatDuration(w.durationS / 60) : "—"}</span></div>
        <div className="card tile"><span className="label">Energy</span><span className="value">{energy !== null ? formatNumber(energy, 0) : "—"}<span className="unit">{energy !== null ? "kcal" : ""}</span></span><span className="meta">{w.energyKcal === null && linked?.energyKcal ? `from ${linked.sourceName ?? "Apple Health"}` : energy === null ? "not recorded" : ""}</span></div>
        <div className="card tile"><span className="label">Avg heart rate</span><span className="value">{hr !== null ? formatNumber(hr, 0) : "—"}<span className="unit">{hr !== null ? "bpm" : ""}</span></span><span className="meta">{hr === null ? "not recorded" : ""}</span></div>
        <div className="card tile">
          {w.exerciseCount > 0 ? (
            <><span className="label">Volume</span><span className="value">{m(w.volumeKg)}<span className="unit">{mu}</span></span><span className="meta">{w.setCount} working sets</span></>
          ) : (
            <><span className="label">Distance</span><span className="value">{w.distanceM ? formatNumber(toDisplay(w.distanceM, "m", settings.units).value, 2) : "—"}<span className="unit">{w.distanceM ? toDisplay(w.distanceM, "m", settings.units).unit : ""}</span></span></>
          )}
        </div>
      </section>
      {w.notes && <p className="section muted">{w.notes}</p>}
      {w.exerciseCount === 0 ? (
        <div className="card section">
          <p className="muted">
            This workout came from Apple Health, which records a summary (type, duration, energy, distance, heart rate) but not exercises, sets or weights.
            Import a Hevy export for exercise-level detail.
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
