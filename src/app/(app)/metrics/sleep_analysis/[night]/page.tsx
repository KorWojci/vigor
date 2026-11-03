import Link from "next/link";
import { notFound } from "next/navigation";
import { SleepHypnogram } from "@/components/SleepHypnogram";
import { SleepSummaryCard } from "@/components/SleepSummaryCard";
import { EmptyState, FlashMessage, PageHead } from "@/components/ui";
import { getSleepNights, getSleepStageTimeline } from "@/lib/aggregation/series";
import { getSleepSummary } from "@/lib/ai/repo";
import { config } from "@/lib/config";
import { appContext, db } from "@/lib/server/context";
import { formatDate, formatDateTime, makeRange } from "@/lib/time";
import { formatDuration } from "@/lib/units";

export const metadata = { title: "Sleep" };

export default async function SleepNightPage({ params, searchParams }: { params: Promise<{ night: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { tz } = await appContext();
  const { night } = await params;
  const sp = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) notFound();
  const database = db();
  const range = makeRange(night, night, tz);
  const nightData = getSleepNights(database, range, tz).find((n) => n.day === night);
  const summary = getSleepSummary(database, night);

  return (
    <>
      <PageHead
        eyebrow="Sleep"
        title={formatDate(night, tz)}
        sub={nightData ? `${formatDateTime(nightData.startMs, tz).split(", ")[1]} – ${formatDateTime(nightData.endMs, tz).split(", ")[1]}` : undefined}
      >
        <Link href="/metrics/sleep_analysis" className="btn small">← Sleep history</Link>
      </PageHead>
      <FlashMessage searchParams={sp} />

      {!nightData ? (
        <div className="card">
          <EmptyState title="No sleep data for this night" />
        </div>
      ) : (
        <>
          <section className="grid grid-4">
            <div className="card tile"><span className="label">Asleep</span><span className="value">{formatDuration(nightData.asleepMin)}</span></div>
            <div className="card tile"><span className="label">In bed</span><span className="value">{nightData.inBedMin !== null ? formatDuration(nightData.inBedMin) : "—"}</span></div>
            <div className="card tile"><span className="label">Awake</span><span className="value">{formatDuration(nightData.awakeMin)}</span></div>
            <div className="card tile">
              <span className="label">Bedtime → wake</span>
              <span className="value" style={{ fontSize: "1.1rem" }}>{formatDateTime(nightData.startMs, tz).split(", ")[1]} – {formatDateTime(nightData.endMs, tz).split(", ")[1]}</span>
            </div>
          </section>

          <section className="card section">
            <h2>Sleep stages</h2>
            <SleepHypnogram segments={getSleepStageTimeline(database, nightData.startMs, nightData.endMs)} startMs={nightData.startMs} endMs={nightData.endMs} tz={tz} />
            <p className="tiny faint" style={{ marginTop: 8 }}>Sources: {nightData.sources.join(", ")}</p>
          </section>

          <SleepSummaryCard summary={summary} night={night} returnTo={`/metrics/sleep_analysis/${night}`} hasApiKey={!!config.geminiApiKey} />
        </>
      )}
    </>
  );
}
