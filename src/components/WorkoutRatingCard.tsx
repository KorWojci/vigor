import { generateWorkoutRatingAction } from "@/app/ai-actions";
import type { WorkoutRating } from "@/lib/ai/repo";
import { WORKOUT_RATING_LABELS, type WorkoutRatingLabel } from "@/lib/ai/workout-rating";
import { formatRelative } from "@/lib/time";

const RATING_LABEL_TEXT: Record<WorkoutRatingLabel, string> = { strong: "Strong", solid: "Solid", light: "Light", off: "Worth a look" };
/** Reuses the app's existing pill tones — green only for a clear standout, amber only for the one case worth a second look. */
const RATING_PILL_CLASS: Record<WorkoutRatingLabel, string> = { strong: "ok", solid: "", light: "", off: "stale" };

/** AI rating for one workout (src/lib/ai/workout-rating.ts) — same explicit-trigger-only rule as the weekly recap. No client JS. */
export function WorkoutRatingCard({ rating, workoutId, returnTo, hasApiKey }: { rating: WorkoutRating | null; workoutId: number; returnTo: string; hasApiKey: boolean }) {
  const label = rating && WORKOUT_RATING_LABELS.includes(rating.rating as WorkoutRatingLabel) ? (rating.rating as WorkoutRatingLabel) : null;
  return (
    <div className="card section">
      <div className="card-head"><h2>AI rating</h2></div>
      {!hasApiKey ? (
        <p className="muted small">
          Set <code>GEMINI_API_KEY</code> in <code>.env</code> to enable an AI rating of this workout — see <code>.env.example</code>.
        </p>
      ) : (
        <>
          {!rating || !label ? (
            <p className="muted small">Not rated yet.</p>
          ) : (
            <>
              <span className={`pill ${RATING_PILL_CLASS[label]}`}><span className="dot" />{RATING_LABEL_TEXT[label]}</span>
              <p className="small" style={{ marginTop: 8 }}>{rating.summary}</p>
              <p className="tiny faint" style={{ marginTop: 8 }}>Generated {formatRelative(rating.generatedAt)} · {rating.model}</p>
              <details style={{ marginTop: 6 }}>
                <summary className="tiny faint" style={{ cursor: "pointer" }}>What was sent to Gemini</summary>
                <pre className="tiny" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{rating.prompt}</pre>
              </details>
            </>
          )}
          <form action={generateWorkoutRatingAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="workoutId" value={workoutId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className={rating ? "btn small" : "btn primary small"}>{rating ? "Regenerate" : "Rate this workout"}</button>
          </form>
        </>
      )}
    </div>
  );
}
