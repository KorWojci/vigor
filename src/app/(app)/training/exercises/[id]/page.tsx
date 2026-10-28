import Link from "next/link";
import { notFound } from "next/navigation";
import { MultiLineChart } from "@/components/charts";
import { FlashMessage, PageHead } from "@/components/ui";
import { appContext, db } from "@/lib/server/context";
import { EXERCISE_KINDS, MAX_E1RM_REPS } from "@/lib/training/calculations";
import { ATTRIBUTION, getExerciseMedia } from "@/lib/training/exercise-media";
import { getExerciseHistory } from "@/lib/training/repo";
import { dayKey, formatDate } from "@/lib/time";
import { formatDuration, formatNumber, toDisplay } from "@/lib/units";
import { setKindAction } from "../../actions";

export default async function ExercisePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const { id } = await params;
  const sp = await searchParams;
  const h = getExerciseHistory(db(), Number(id));
  if (!h) notFound();
  const { exercise, sessions, records } = h;
  const media = getExerciseMedia(db(), exercise.id);
  const kind = exercise.kind;
  const mu = settings.units === "imperial" ? "lb" : "kg";
  const m = (kg: number | null) => (kg === null ? null : Math.round(toDisplay(kg, "kg", settings.units).value * 10) / 10);
  const weighted = kind === "weighted" || kind === "weighted_bodyweight";

  const chartData = sessions.map((s) => ({
    day: dayKey(s.startMs, tz),
    e1rm: m(s.stats.bestE1RM),
    maxWeight: m(s.stats.maxWeightKg),
    volume: m(s.stats.volumeKg),
    reps: s.stats.totalReps,
    maxReps: Math.max(0, ...s.sets.filter((x) => x.setType !== "warmup").map((x) => x.reps ?? 0)),
    assistance: m(s.stats.minAssistanceKg),
    duration: s.stats.totalDurationS / 60,
    distance: s.stats.totalDistanceM,
  }));
  const series =
    weighted
      ? [
          { key: "e1rm", label: `Estimated 1RM (${mu})`, color: "var(--chart-1)" },
          { key: "maxWeight", label: `Heaviest set (${mu})`, color: "var(--chart-2)", dashed: true },
          { key: "volume", label: `Volume (${mu})`, color: "var(--chart-3)", axis: "right" as const },
        ]
      : kind === "assisted"
        ? [
            { key: "assistance", label: `Least assistance (${mu})`, color: "var(--chart-1)" },
            { key: "reps", label: "Total reps", color: "var(--chart-3)", axis: "right" as const },
          ]
        : kind === "bodyweight"
          ? [
              { key: "maxReps", label: "Best set (reps)", color: "var(--chart-1)" },
              { key: "reps", label: "Total reps", color: "var(--chart-3)", dashed: true },
            ]
          : kind === "duration"
            ? [{ key: "duration", label: "Total time (min)", color: "var(--chart-1)" }]
            : [{ key: "distance", label: "Total distance (m)", color: "var(--chart-1)" }];

  const recValue = (r: (typeof records)[number]) =>
    r.unit === "kg" ? `${formatNumber(m(r.value)!, 1)} ${mu}` : r.unit === "s" ? formatDuration(r.value / 60) : r.unit === "m" ? `${formatNumber(r.value, 0)} m` : `${r.value} reps`;
  const setText = (s: (typeof sessions)[number]["sets"][number]) => {
    const parts: string[] = [];
    if (s.weightKg !== null) parts.push(`${formatNumber(m(s.weightKg)!, 1)} ${mu}${kind === "assisted" ? " assist" : ""}`);
    if (s.reps !== null) parts.push(`${s.reps} reps`);
    if (s.durationS !== null) parts.push(formatDuration(s.durationS / 60));
    if (s.distanceM !== null) parts.push(`${formatNumber(s.distanceM, 0)} m`);
    return parts.join(" × ") || "—";
  };

  return (
    <>
      <FlashMessage searchParams={sp} />
      <PageHead eyebrow="Exercise" title={exercise.name} sub={`${EXERCISE_KINDS.find((k) => k.key === kind)?.label} · ${exercise.sessions} sessions${exercise.firstMs ? ` since ${formatDate(exercise.firstMs, tz)}` : ""}`}>
        <Link href="/training" className="btn small">← Training</Link>
      </PageHead>

      <section className="grid grid-4">
        {records.map((r) => (
          <Link key={r.label} href={`/training/workouts/${r.workoutId}`} className="card tile">
            <span className="label">{r.label}</span>
            <span className="value" style={{ fontSize: "1.6rem" }}>{recValue(r)}</span>
            <span className="meta">{formatDate(r.startMs, tz)}{r.detail ? ` · ${r.detail}` : ""}</span>
          </Link>
        ))}
        {records.length === 0 && <div className="card"><p className="muted">No personal records yet — sets need weight, reps, time or distance.</p></div>}
      </section>

      {media && (
        <section className="card section">
          <div className="card-head">
            <h2>How to perform it</h2>
            {media.matchScore < 1 && (
              <span className="tiny faint">closest match ({Math.round(media.matchScore * 100)}%): &ldquo;{media.matchedName}&rdquo; — may not be this exact exercise</span>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- cached locally, served by our own authenticated route, not a remote URL */}
          <img src={`/api/exercise-media/${exercise.id}`} alt={`${media.matchedName} demonstration`} style={{ maxWidth: 320, borderRadius: 8, display: "block" }} />
          <p className="small muted" style={{ marginTop: 8 }}>
            Targets {media.targetMuscles.join(", ") || "—"}
            {media.secondaryMuscles.length > 0 ? `; also works ${media.secondaryMuscles.join(", ")}` : ""}.
          </p>
          <p className="tiny faint">{ATTRIBUTION}</p>
        </section>
      )}

      <section className="card section">
        <h2>Progress</h2>
        {sessions.length < 2 ? <p className="muted">Progress charts appear after two sessions.</p> : <MultiLineChart data={chartData} series={series} decimals={1} />}
        {weighted && <p className="tiny faint">Estimated 1RM uses the Epley formula on working sets of 1–{MAX_E1RM_REPS} reps. {kind === "weighted_bodyweight" ? "Weight is the added load only." : ""}</p>}
      </section>

      <section className="grid grid-2 section">
        <div className="card">
          <h2>Sessions</h2>
          <div className="table-wrap" style={{ maxHeight: 600, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Date</th><th>Sets</th>{weighted && <th className="r">e1RM</th>}{weighted && <th className="r">Volume</th>}</tr></thead>
              <tbody>
                {[...sessions].reverse().map((s) => (
                  <tr key={s.workoutId}>
                    <td className="small"><Link href={`/training/workouts/${s.workoutId}`}>{formatDate(s.startMs, tz)}</Link><div className="tiny faint">{s.workoutTitle}</div></td>
                    <td className="small">
                      {s.sets.map((x, i) => (
                        <div key={i} className={x.setType === "warmup" ? "faint" : undefined}>
                          {setText(x)}
                          {x.setType !== "normal" && <span className="badge" style={{ marginLeft: 6 }}>{x.setType}</span>}
                          {x.rpe ? <span className="faint"> @ RPE {x.rpe}</span> : null}
                        </div>
                      ))}
                    </td>
                    {weighted && <td className="r num">{s.stats.bestE1RM ? formatNumber(m(s.stats.bestE1RM)!, 1) : "—"}</td>}
                    {weighted && <td className="r num">{formatNumber(m(s.stats.volumeKg)!, 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Exercise type</h2>
          <p className="small muted">The type decides how progress is measured. Vigor infers it from the name and recorded sets; override it if the guess is wrong.</p>
          <form action={setKindAction} className="form">
            <input type="hidden" name="exerciseId" value={exercise.id} />
            {[{ key: "auto", label: "Automatic", description: "Infer from name and sets." }, ...EXERCISE_KINDS].map((k) => (
              <label key={k.key} className="check">
                <input type="radio" name="kind" value={k.key} defaultChecked={k.key === "auto" ? !exercise.kindLocked : exercise.kindLocked && exercise.kind === k.key} />
                <span><strong>{k.label}</strong> <span className="small muted">— {k.description}</span></span>
              </label>
            ))}
            <div><button className="btn primary">Save</button></div>
          </form>
          {exercise.aliases.length > 0 && <p className="small muted" style={{ marginTop: 12 }}>Also imported as: {exercise.aliases.join(", ")}</p>}
          <p className="small"><Link href="/settings?tab=training">Merge with another exercise →</Link></p>
        </div>
      </section>
    </>
  );
}
