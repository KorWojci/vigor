import { generateSleepSummaryAction } from "@/app/ai-actions";
import type { SleepSummary } from "@/lib/ai/repo";
import { formatRelative } from "@/lib/time";

/** AI summary for one night's sleep (src/lib/ai/sleep-summary.ts) — same explicit-trigger-only rule as the weekly recap. No client JS. */
export function SleepSummaryCard({ summary, night, returnTo, hasApiKey }: { summary: SleepSummary | null; night: string; returnTo: string; hasApiKey: boolean }) {
  return (
    <div className="card section">
      <div className="card-head"><h2>Sleep summary</h2></div>
      {!hasApiKey ? (
        <p className="muted small">
          Set <code>GEMINI_API_KEY</code> in <code>.env</code> to enable an AI summary of this night — see <code>.env.example</code>.
        </p>
      ) : (
        <>
          {summary ? (
            <>
              <p className="small">{summary.summary}</p>
              <p className="tiny faint" style={{ marginTop: 8 }}>Generated {formatRelative(summary.generatedAt)} · {summary.model}</p>
              <details style={{ marginTop: 6 }}>
                <summary className="tiny faint" style={{ cursor: "pointer" }}>What was sent to Gemini</summary>
                <pre className="tiny" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{summary.prompt}</pre>
              </details>
            </>
          ) : (
            <p className="muted small">Not summarised yet.</p>
          )}
          <form action={generateSleepSummaryAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="night" value={night} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className={summary ? "btn small" : "btn primary small"}>{summary ? "Regenerate" : "Summarise this night"}</button>
          </form>
        </>
      )}
    </div>
  );
}
