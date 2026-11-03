import { generateRecapAction } from "@/app/ai-actions";
import type { RecapScope, WeeklyRecap } from "@/lib/ai/repo";
import { weeklyRecapResultSchema, weeklyTrainingRecapResultSchema, type WeeklyRecapResult, type WeeklyTrainingRecapResult } from "@/lib/ai/weekly-recap";
import { formatRelative } from "@/lib/time";

/**
 * Shows the cached weekly recap (src/lib/ai/weekly-recap.ts) and a Generate/Regenerate button.
 * No client JS — a server-rendered form posting to a server action, like the rest of the app.
 * `scope` picks the schema: "full" (training+sleep+nutrition, with a sleep-by-night section) or
 * "training" (training facts only, used on the Training page).
 */

type ParsedRecap = WeeklyRecapResult | WeeklyTrainingRecapResult | { legacyText: string };

/** Recaps generated before the structured-JSON redesign stored plain prose; show it as-is rather than erroring. */
function parseRecapContent(content: string, scope: RecapScope): ParsedRecap {
  try {
    const schema = scope === "full" ? weeklyRecapResultSchema : weeklyTrainingRecapResultSchema;
    const parsed = schema.safeParse(JSON.parse(content));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through — not JSON, must be a legacy plain-text recap
  }
  return { legacyText: content };
}

function hasSleepByNight(p: ParsedRecap): p is WeeklyRecapResult {
  return "sleepByNight" in p;
}

export function WeeklyRecapCard({
  recap,
  scope,
  title = "Weekly recap",
  weekLabel,
  weekStart,
  returnTo,
  hasApiKey,
}: {
  recap: WeeklyRecap | null;
  scope: RecapScope;
  title?: string;
  weekLabel: string;
  weekStart: string;
  returnTo: string;
  hasApiKey: boolean;
}) {
  const parsed = recap ? parseRecapContent(recap.content, scope) : null;
  return (
    <div className="card section">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="small muted">{weekLabel}</span>
      </div>
      {!hasApiKey ? (
        <p className="muted small">
          Set <code>GEMINI_API_KEY</code> in <code>.env</code> to enable an AI-written recap — see <code>.env.example</code>.
        </p>
      ) : (
        <>
          {!recap || !parsed ? (
            <p className="muted small">No recap generated yet for this week.</p>
          ) : "legacyText" in parsed ? (
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>{parsed.legacyText}</p>
          ) : (
            <>
              <p className="small">{parsed.summary}</p>
              {parsed.goodThings.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <strong className="small">What went well</strong>
                  <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {parsed.goodThings.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}
              {parsed.badThings.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <strong className="small">Worth a look</strong>
                  <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {parsed.badThings.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <strong className="small">Try next week</strong>
                <p className="small" style={{ margin: "4px 0 0" }}>{parsed.suggestion}</p>
              </div>
              {hasSleepByNight(parsed) && parsed.sleepByNight.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <strong className="small">Sleep, night by night</strong>
                  <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {parsed.sleepByNight.map((n) => <li key={n.date}>{n.note}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
          {recap && (
            <>
              <p className="tiny faint" style={{ marginTop: 10 }}>Generated {formatRelative(recap.generatedAt)} · {recap.model}</p>
              <details style={{ marginTop: 6 }}>
                <summary className="tiny faint" style={{ cursor: "pointer" }}>What was sent to Gemini</summary>
                <pre className="tiny" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{recap.prompt}</pre>
              </details>
            </>
          )}
          <form action={generateRecapAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="weekStart" value={weekStart} />
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className={recap ? "btn small" : "btn primary small"}>{recap ? "Regenerate" : "Generate recap"}</button>
          </form>
        </>
      )}
    </div>
  );
}
