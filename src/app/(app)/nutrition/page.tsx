import Link from "next/link";
import { MultiLineChart, TrendChart } from "@/components/charts";
import { Delta, EmptyState, Notice, PageHead, RangeSelector } from "@/components/ui";
import { getDailySeries, getMetricSummary, getSourceBreakdown } from "@/lib/aggregation/series";
import { formatMetric, trendOf } from "@/lib/format";
import { METRICS } from "@/lib/metrics/catalog";
import { appContext, db } from "@/lib/server/context";
import { daysBetween, presetDays, previousRange, rangeFromDays } from "@/lib/time";
import { formatNumber } from "@/lib/units";

export const metadata = { title: "Nutrition" };

export default async function NutritionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const preset = presetDays(sp.range, settings.defaultRange as never);
  const range = rangeFromDays(preset.days, tz);
  const prev = previousRange(range, tz);
  const nutritionMetrics = METRICS.filter((m) => m.group === "nutrition");
  const summaries = nutritionMetrics.map((m) => getMetricSummary(database, m.key, range, prev, tz)!);
  const anyData = summaries.some((s) => s.daysWithData > 0);

  const energy = getDailySeries(database, "dietary_energy", range, tz);
  const macros = ["dietary_protein", "dietary_carbohydrates", "dietary_fat"].map((k) => new Map(getDailySeries(database, k, range, tz).map((d) => [d.day, d.value])));
  const days = daysBetween(range.from, range.to);
  const energyByDay = new Map(energy.map((d) => [d.day, d.value]));
  const macroRows = days
    .filter((d) => macros.some((m) => m.has(d)))
    .map((day) => ({ day, protein: macros[0].get(day) ?? null, carbs: macros[1].get(day) ?? null, fat: macros[2].get(day) ?? null }));

  const avg = (k: string) => summaries.find((s) => s.def.key === k)?.value ?? null;
  const p = avg("dietary_protein");
  const c = avg("dietary_carbohydrates");
  const f = avg("dietary_fat");
  const macroKcal = p !== null && c !== null && f !== null ? p * 4 + c * 4 + f * 9 : null;

  const sources = new Map<string, number>();
  for (const m of nutritionMetrics) for (const s of getSourceBreakdown(database, m.key, range)) sources.set(s.sourceName, (sources.get(s.sourceName) ?? 0) + s.samples);

  return (
    <>
      <PageHead title="Nutrition & hydration" sub="Food and drink logged by apps that share with Apple Health.">
        <RangeSelector current={preset.key} basePath="/nutrition" />
      </PageHead>

      {!anyData ? (
        <div className="card">
          <EmptyState title="No nutrition data in this period">
            <p>Vigor reads nutrition that other apps write to Apple Health; it does not connect to food-tracking services directly.</p>
            <ul className="small" style={{ textAlign: "left", maxWidth: 560, margin: "0 auto" }}>
              <li>In your nutrition app, enable writing to Apple Health (often under Settings → Apps / Health).</li>
              <li>In the Health app → Sharing → Apps, allow that app to write Dietary Energy, Protein, Carbohydrates, Fat and Water.</li>
              <li>Allow the Vigor sync (companion app or Shortcut) to read those dietary types.</li>
              <li>Some apps only write daily totals, or write at the end of the day — that is expected.</li>
            </ul>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="grid grid-4">
            {summaries.filter((s) => ["dietary_energy", "dietary_protein", "dietary_carbohydrates", "dietary_fat"].includes(s.def.key)).map((s) => {
              const v = formatMetric(s.def, s.value, settings.units);
              return (
                <Link key={s.def.key} href={`/metrics/${s.def.key}`} className="card tile">
                  <span className="label">{s.def.label}</span>
                  {s.value === null ? <span className="empty">Not logged</span> : (
                    <>
                      <span className="value">{v.value}<span className="unit">{v.unit}</span></span>
                      <span className="meta">daily average · {s.daysWithData}/{range.days} days logged</span>
                      <Delta trend={trendOf(s.def, s.value, s.previous)} />
                    </>
                  )}
                </Link>
              );
            })}
          </section>

          <section className="grid grid-2 section">
            <div className="card">
              <h2>Energy intake</h2>
              <TrendChart data={days.map((day) => ({ day, value: energyByDay.get(day) ?? null }))} unit="kcal" chart="bar" decimals={0} label="Dietary energy" />
              <p className="tiny faint">Days without a bar had nothing logged — they are not counted as zero in the averages.</p>
            </div>
            <div className="card">
              <h2>Macronutrients</h2>
              {macroRows.length ? (
                <MultiLineChart
                  data={macroRows}
                  unit="g"
                  decimals={0}
                  series={[
                    { key: "protein", label: "Protein", color: "var(--chart-1)" },
                    { key: "carbs", label: "Carbohydrates", color: "var(--chart-2)" },
                    { key: "fat", label: "Fat", color: "var(--chart-3)" },
                  ]}
                />
              ) : <p className="muted">No macronutrient records.</p>}
              {macroKcal !== null && macroKcal > 0 && (
                <div className="legend" style={{ marginTop: 8 }}>
                  <span><i style={{ background: "var(--chart-1)" }} />Protein {formatNumber(((p! * 4) / macroKcal) * 100, 0)}%</span>
                  <span><i style={{ background: "var(--chart-2)" }} />Carbs {formatNumber(((c! * 4) / macroKcal) * 100, 0)}%</span>
                  <span><i style={{ background: "var(--chart-3)" }} />Fat {formatNumber(((f! * 9) / macroKcal) * 100, 0)}%</span>
                  <span className="faint">of energy from macros (4/4/9 kcal per g)</span>
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-2 section">
            <div className="card">
              <h2>All nutrition values</h2>
              <table>
                <thead><tr><th>Nutrient</th><th className="r">Daily average</th><th className="r">Days logged</th></tr></thead>
                <tbody>
                  {summaries.map((s) => (
                    <tr key={s.def.key}>
                      <td><Link href={`/metrics/${s.def.key}`}>{s.def.label}</Link></td>
                      <td className="r num">{s.value === null ? <span className="faint">not logged</span> : `${formatMetric(s.def, s.value, settings.units).value} ${formatMetric(s.def, s.value, settings.units).unit}`}</td>
                      <td className="r num">{s.daysWithData}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2>Contributing apps</h2>
              {sources.size === 0 ? <p className="muted small">None in this period.</p> : (
                <table>
                  <tbody>
                    {[...sources.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (
                      <tr key={name}><td>{name}</td><td className="r num small muted">{n.toLocaleString()} entries</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ marginTop: 12 }}>
                <Notice>
                  <p className="small">
                    Entries from different apps are added together (each meal is usually logged once). If two apps log the same food, totals will be
                    inflated — keep only one app writing nutrition to Apple Health. Fields an app does not record (e.g. fibre) appear as “not logged”.
                  </p>
                </Notice>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
