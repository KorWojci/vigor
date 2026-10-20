import Link from "next/link";
import { TrendChart } from "@/components/charts";
import { FlashMessage, PageHead } from "@/components/ui";
import { CANONICAL_UNIT, latestMeasurements, listMeasurements, listMeasurementTypes } from "@/lib/body/repo";
import { appContext, db } from "@/lib/server/context";
import { dayKey, formatDate, formatDateTime, tzOffsetMs } from "@/lib/time";
import { displayUnitFor, formatNumber, toDisplay } from "@/lib/units";
import { addMeasurementAction, createTypeAction, deleteMeasurementAction, deleteTypeAction } from "./actions";

export const metadata = { title: "Body measurements" };

export default async function BodyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { settings, tz } = await appContext();
  const sp = await searchParams;
  const database = db();
  const types = listMeasurementTypes(database);
  const latest = latestMeasurements(database);
  const selected = types.find((t) => t.key === sp.type) ?? types.find((t) => latest.has(t.key)) ?? types[0];
  const entries = listMeasurements(database, selected.key);
  const unitOf = (dim: keyof typeof CANONICAL_UNIT) => displayUnitFor(CANONICAL_UNIT[dim], settings.units);
  const show = (v: number, dim: keyof typeof CANONICAL_UNIT) => formatNumber(toDisplay(v, CANONICAL_UNIT[dim], settings.units).value, 1);
  const nowLocal = new Date(Date.now() + tzOffsetMs(Date.now(), tz)).toISOString().slice(0, 16);
  const chart = [...entries].reverse().map((e) => ({ day: dayKey(e.measuredAt, tz), value: toDisplay(e.value, CANONICAL_UNIT[selected.dimension], settings.units).value }));

  const change = (a: number, b: number, dim: keyof typeof CANONICAL_UNIT) => {
    const d = toDisplay(a, CANONICAL_UNIT[dim], settings.units).value - toDisplay(b, CANONICAL_UNIT[dim], settings.units).value;
    if (Math.abs(d) < 0.05) return <span className="faint">±0</span>;
    return <span className="num">{d > 0 ? "+" : "−"}{formatNumber(Math.abs(d), 1)}</span>;
  };

  return (
    <>
      <FlashMessage searchParams={sp} />
      <PageHead title="Body measurements" sub="Manual tape and scale measurements. Every entry is kept; nothing is overwritten." />

      <section className="grid grid-2">
        <div className="card">
          <h2>Add a measurement</h2>
          <form action={addMeasurementAction} className="form">
            <div className="form-row">
              <label className="field">
                <span>Measurement</span>
                <select name="type" defaultValue={selected.key}>
                  {types.map((t) => (
                    <option key={t.key} value={t.key}>{t.label} ({unitOf(t.dimension)})</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Value</span>
                <input name="value" type="number" step="0.1" min="0" inputMode="decimal" required />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Measured at <span className="hint">({tz})</span></span>
                <input name="measuredAt" type="datetime-local" defaultValue={nowLocal} required />
              </label>
              <label className="field">
                <span>Note <span className="hint">(optional)</span></span>
                <input name="note" maxLength={200} placeholder="e.g. morning, before breakfast" />
              </label>
            </div>
            <div><button className="btn primary">Save measurement</button></div>
            <p className="tiny faint">Units follow your preference ({settings.units}). Weight, height, body fat and lean mass also appear alongside Apple Health readings.</p>
          </form>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>{selected.label}</h2>
            <span className="small muted">{unitOf(selected.dimension)}</span>
          </div>
          {chart.length ? (
            <TrendChart data={chart} unit={unitOf(selected.dimension)} chart="line" decimals={1} height={230} label={selected.label} />
          ) : (
            <p className="muted">No {selected.label.toLowerCase()} entries yet.</p>
          )}
        </div>
      </section>

      <section className="card section">
        <h2>Overview</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Measurement</th><th className="r">Latest</th><th>Date</th><th className="r">Since previous</th><th className="r">Since first</th><th className="r">Entries</th></tr></thead>
            <tbody>
              {types.map((t) => {
                const l = latest.get(t.key);
                return (
                  <tr key={t.key} style={t.key === selected.key ? { background: "var(--bronze-soft)" } : undefined}>
                    <td><Link href={`/body?type=${t.key}`}>{t.label}</Link>{!t.builtin && <span className="badge" style={{ marginLeft: 6 }}>custom</span>}</td>
                    <td className="r num">{l ? `${show(l.latest.value, t.dimension)} ${unitOf(t.dimension)}` : <span className="faint">—</span>}</td>
                    <td className="small muted">{l ? formatDate(l.latest.measuredAt, tz) : ""}</td>
                    <td className="r small">{l?.previous ? change(l.latest.value, l.previous.value, t.dimension) : ""}</td>
                    <td className="r small">{l && l.count > 1 ? change(l.latest.value, l.first.value, t.dimension) : ""}</td>
                    <td className="r num small">{l?.count ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-2 section">
        <div className="card">
          <h2>{selected.label} history</h2>
          {entries.length === 0 ? <p className="muted small">No entries.</p> : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="small">{formatDateTime(e.measuredAt, tz)}</td>
                      <td className="r num">{show(e.value, selected.dimension)} {unitOf(selected.dimension)}</td>
                      <td className="small muted">{e.note}</td>
                      <td className="r">
                        <form action={deleteMeasurementAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="type" value={selected.key} />
                          <button className="btn small danger" aria-label="Delete entry">Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <h2>Custom measurements</h2>
          <p className="small muted">Track anything else — wrist, ankle, a skinfold site, grip strength in kg…</p>
          <form action={createTypeAction} className="form">
            <div className="form-row">
              <label className="field"><span>Name</span><input name="label" maxLength={60} required placeholder="e.g. Wrist" /></label>
              <label className="field">
                <span>Kind</span>
                <select name="dimension" defaultValue="length">
                  <option value="length">Length ({unitOf("length")})</option>
                  <option value="mass">Mass ({unitOf("mass")})</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </label>
            </div>
            <div><button className="btn">Add measurement type</button></div>
          </form>
          {types.some((t) => !t.builtin) && (
            <table style={{ marginTop: 14 }}>
              <tbody>
                {types.filter((t) => !t.builtin).map((t) => (
                  <tr key={t.key}>
                    <td>{t.label}</td>
                    <td className="r">
                      <form action={deleteTypeAction}>
                        <input type="hidden" name="key" value={t.key} />
                        <button className="btn small danger">Delete with history</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
