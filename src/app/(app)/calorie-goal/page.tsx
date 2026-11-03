import Link from "next/link";
import { EmptyState, FlashMessage, Notice, PageHead } from "@/components/ui";
import { getLatestReading, getMetricSummary } from "@/lib/aggregation/series";
import { ACTIVITY_LEVELS, classifyActivityLevel, estimateTdee, MIN_DAYS_FOR_MEASURED, planWeightGoal } from "@/lib/health/calorie-goal";
import { appContext, db } from "@/lib/server/context";
import { formatDate, previousRange, rangeFromDays } from "@/lib/time";
import { displayUnitFor, formatNumber, toDisplay } from "@/lib/units";
import { saveGoalAction } from "./actions";

export const metadata = { title: "Calorie goal" };

export default async function CalorieGoalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const units = settings.units;
  const weightUnit = displayUnitFor("kg", units);

  const weight = getLatestReading(database, "body_mass");
  if (!weight) {
    return (
      <>
        <PageHead title="Calorie goal" sub="A daily calorie target and a projected date to reach a goal weight." />
        <FlashMessage searchParams={sp} />
        <div className="card">
          <EmptyState title="No weight logged yet">
            <p>This needs at least one weight reading to work from.</p>
            <Link className="btn primary" href="/body?type=weight">Log your weight</Link>
          </EmptyState>
        </div>
      </>
    );
  }
  const currentWeightKg = weight.value;
  const height = getLatestReading(database, "height");
  const heightCm = height?.value ?? null;
  const age = settings.profile.birthYear ? new Date().getUTCFullYear() - settings.profile.birthYear : null;
  const sex = settings.profile.sex;

  const range = rangeFromDays(30, tz);
  const previous = previousRange(range, tz);
  const basal = getMetricSummary(database, "basal_energy", range, previous, tz);
  const active = getMetricSummary(database, "active_energy", range, previous, tz);
  const dietary = getMetricSummary(database, "dietary_energy", range, previous, tz);

  const measuredBasalKcal = basal && basal.daysWithData >= MIN_DAYS_FOR_MEASURED ? basal.value : null;
  const measuredActiveKcal = active && active.daysWithData >= MIN_DAYS_FOR_MEASURED ? active.value : null;

  const steps = getMetricSummary(database, "step_count", range, previous, tz);
  const exercise = getMetricSummary(database, "exercise_time", range, previous, tz);
  const estimatedActivityLevel = classifyActivityLevel({
    avgStepsPerDay: steps && steps.daysWithData >= MIN_DAYS_FOR_MEASURED ? steps.value : null,
    avgExerciseMinPerWeek: exercise && exercise.daysWithData >= MIN_DAYS_FOR_MEASURED && exercise.value != null ? exercise.value * 7 : null,
  });

  const goal = settings.weightGoal;
  const tdee = estimateTdee({
    weightKg: currentWeightKg,
    heightCm,
    age,
    sex,
    activityLevel: goal.activityLevel,
    measuredBasalKcal,
    measuredActiveKcal,
  });

  const plan = goal.targetWeightKg
    ? planWeightGoal({
        currentWeightKg,
        targetWeightKg: goal.targetWeightKg,
        weeklyRateKg: goal.weeklyRateKg,
        tdeeKcal: tdee.tdeeKcal,
        bmrKcal: tdee.bmrKcal,
        sex,
        nowMs: Date.now(),
      })
    : null;

  const rateOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5];

  return (
    <>
      <PageHead title="Calorie goal" sub="A daily calorie target and a projected date to reach a goal weight." />
      <FlashMessage searchParams={sp} />

      <div className="grid grid-2 section">
        <div className="card">
          <h2>Your numbers</h2>
          <dl className="kv">
            <dt>Current weight</dt>
            <dd>{formatNumber(toDisplay(currentWeightKg, "kg", units).value, 1)} {weightUnit} <span className="tiny faint">· <Link href="/body?type=weight">update</Link></span></dd>
            <dt>Height</dt>
            <dd>{heightCm != null ? `${formatNumber(toDisplay(heightCm, "cm", units).value, 0)} ${displayUnitFor("cm", units)}` : <span className="muted">not set</span>} <span className="tiny faint">· <Link href="/body?type=height">update</Link></span></dd>
            <dt>Age / sex</dt>
            <dd>{age ?? <span className="muted">not set</span>} / {sex && sex !== "unspecified" ? sex : <span className="muted">not set</span>} <span className="tiny faint">· <Link href="/settings?tab=profile">update</Link></span></dd>
          </dl>
          {(heightCm == null || age == null || sex === "unspecified") && (
            <p className="tiny faint" style={{ marginTop: 6 }}>Height, birth year and sex let Vigor estimate your resting energy (BMR) as a fallback, and set a safe calorie floor.</p>
          )}
        </div>

        <div className="card">
          <h2>Daily energy</h2>
          {tdee.tdeeKcal == null ? (
            <p className="muted small">Not enough data yet to estimate your daily energy need — sync a few days of Apple Health activity, or set height, birth year and sex in your profile.</p>
          ) : (
            <>
              <dl className="kv">
                <dt>Resting energy</dt>
                <dd>{formatNumber(tdee.basalKcal!, 0)} kcal <span className="tiny faint">({tdee.basalSource === "measured" ? `measured, avg of last 30 days` : "estimated — Mifflin-St Jeor formula"})</span></dd>
                <dt>Active energy</dt>
                <dd>{formatNumber(tdee.activeKcal!, 0)} kcal <span className="tiny faint">({tdee.activeSource === "measured" ? `measured, avg of last 30 days` : `estimated — ${ACTIVITY_LEVELS.find((l) => l.key === goal.activityLevel)?.label.split(" —")[0].toLowerCase()}`})</span></dd>
                <dt>Maintenance (TDEE)</dt>
                <dd><strong>{formatNumber(tdee.tdeeKcal, 0)} kcal/day</strong></dd>
              </dl>
              {(tdee.basalSource === "formula" || tdee.activeSource === "formula") && (
                <p className="tiny faint" style={{ marginTop: 6 }}>Parts shown as estimated will switch to measured automatically once {MIN_DAYS_FOR_MEASURED}+ days of that data have synced from Apple Health.</p>
              )}
            </>
          )}
        </div>
      </div>

      <form action={saveGoalAction} className="card form section">
        <h2>Your goal</h2>
        <div className="form-row">
          <label className="field">
            <span>Target weight <span className="hint">({weightUnit})</span></span>
            <input name="targetWeight" type="number" step="0.1" min="0" inputMode="decimal" defaultValue={goal.targetWeightKg != null ? formatNumber(toDisplay(goal.targetWeightKg, "kg", units).value, 1) : ""} />
          </label>
          <label className="field">
            <span>Pace</span>
            <select name="weeklyRate" defaultValue={String(goal.weeklyRateKg)}>
              {rateOptions.map((kg) => (
                <option key={kg} value={kg}>{formatNumber(toDisplay(kg, "kg", units).value, 2)} {weightUnit}/week</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Activity level <span className="hint">(fallback only, see below)</span></span>
            <select name="activityLevel" defaultValue={goal.activityLevel}>
              {ACTIVITY_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              <option value="auto" disabled={estimatedActivityLevel == null}>
                {estimatedActivityLevel != null
                  ? `Calculate mine — currently ${ACTIVITY_LEVELS.find((l) => l.key === estimatedActivityLevel)!.label.split(" —")[0]}`
                  : "Calculate mine (not enough step/exercise data yet)"}
              </option>
            </select>
          </label>
        </div>
        <p className="tiny faint">
          A direction (lose/gain) is worked out automatically from your target vs. current weight. Activity level is only used to estimate active energy when there isn&apos;t enough measured history yet
          — &ldquo;Calculate mine&rdquo; sets it from your last {MIN_DAYS_FOR_MEASURED}+ days of steps and exercise minutes instead of a guess, and re-checks itself each time you save.
        </p>
        <div><button className="btn primary">Save goal</button></div>
      </form>

      {plan && (
        <div className="card section">
          <h2>Plan</h2>
          {tdee.tdeeKcal == null ? (
            <p className="muted small">Set height, birth year and sex in your profile, or sync some activity data, to get a daily calorie target.</p>
          ) : plan.weeksToGoal === 0 ? (
            <p className="small">You&apos;re already at your target weight.</p>
          ) : (
            <>
              <div className="row" style={{ gap: 28, flexWrap: "wrap" }}>
                <div className="tile">
                  <span className="label">Daily target</span>
                  <span className="value">{plan.dailyTargetKcal != null ? `${formatNumber(plan.dailyTargetKcal, 0)}` : "—"}<span className="unit">kcal</span></span>
                  <span className="meta">{plan.dailyDeltaKcal < 0 ? "deficit" : plan.dailyDeltaKcal > 0 ? "surplus" : "maintenance"} of {formatNumber(Math.abs(plan.dailyDeltaKcal), 0)} kcal/day</span>
                </div>
                <div className="tile">
                  <span className="label">Projected date</span>
                  <span className="value" style={{ fontSize: "1.2rem" }}>{plan.projectedAtMs != null ? formatDate(plan.projectedAtMs, tz) : "—"}</span>
                  <span className="meta">{plan.weeksToGoal != null ? `~${formatNumber(plan.weeksToGoal, 1)} weeks away` : "set a pace above 0 to project a date"}</span>
                </div>
              </div>
              <p className="tiny faint" style={{ marginTop: 10 }}>
                Based on the standard planning approximation of {formatNumber(7700, 0)} kcal per kg of body-weight change. Real-world weight change isn&apos;t perfectly linear
                (water retention, metabolic adaptation) — treat the date as a rough estimate, and re-check this page as new weight readings come in.
              </p>
              {plan.warnings.map((w, i) => <Notice key={i} tone="warn"><p className="small">{w}</p></Notice>)}
            </>
          )}
        </div>
      )}

      {dietary && dietary.daysWithData > 0 && plan?.dailyTargetKcal != null && (
        <div className="card section">
          <h2>How you&apos;re tracking</h2>
          <p className="small">
            Your logged intake has averaged <strong>{formatNumber(dietary.value!, 0)} kcal/day</strong> over the last 30 days ({dietary.daysWithData} days logged),
            which is about {formatNumber(Math.abs(dietary.value! - plan.dailyTargetKcal), 0)} kcal/day {dietary.value! > plan.dailyTargetKcal ? "above" : "below"} your target.
          </p>
        </div>
      )}
    </>
  );
}
