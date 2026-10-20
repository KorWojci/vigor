import Link from "next/link";
import { PageHead } from "@/components/ui";
import { getLatestReading, getMetricInventory } from "@/lib/aggregation/series";
import { formatMetricText } from "@/lib/format";
import { METRIC_GROUPS, METRICS } from "@/lib/metrics/catalog";
import { appContext, db } from "@/lib/server/context";
import { formatDate } from "@/lib/time";

export const metadata = { title: "Health metrics" };

export default async function MetricsPage() {
  const { settings, tz } = await appContext();
  const database = db();
  const inventory = getMetricInventory(database);
  return (
    <>
      <PageHead
        title="Health metrics"
        sub="Everything imported from Apple Health and compatible sources, grouped by area. Select a metric for its full history."
      />
      <div className="grid grid-2">
        {METRIC_GROUPS.map((g) => (
          <section key={g.key} className="card">
            <h2>{g.label}</h2>
            <table>
              <tbody>
                {METRICS.filter((m) => m.group === g.key).map((m) => {
                  const inv = inventory.get(m.key);
                  const latest = inv && m.aggregation !== "sleep" && m.aggregation !== "sum" ? getLatestReading(database, m.key) : null;
                  return (
                    <tr key={m.key}>
                      <td>
                        <Link href={`/metrics/${m.key}`}>{m.label}</Link>
                      </td>
                      <td className="small">
                        {inv ? (
                          <>
                            {latest ? <strong className="num">{formatMetricText(m, latest.value, settings.units)}</strong> : <span className="muted">{inv.samples.toLocaleString()} samples</span>}
                            <div className="tiny faint">last {inv.lastMs ? formatDate(inv.lastMs, tz) : "—"}</div>
                          </>
                        ) : (
                          <span className="faint" title={`No ${m.healthKit ?? m.key} samples have been received.`}>No data imported</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="small muted section">
        “No data imported” means Vigor has never received this type — not that the value is zero. Check that the type is enabled in your sync
        source and that Health permissions were granted (see <Link href="/integrations/apple-health">Apple Health sync</Link>). To add a new
        metric type, see <code>src/lib/metrics/catalog.ts</code>.
      </p>
    </>
  );
}
