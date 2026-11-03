# Architecture

This document is for developers and coding agents continuing work on Vigor.

## Goals that shape the design

1. **Single user, self-hosted, low maintenance.** There is one process and one SQLite file, with no message queues, workers or external services.
2. **Accuracy over completeness.** Missing data is never rendered as zero. Overlapping sources are never double counted. Nothing is synthesised, except the opt-in demo data, which is clearly labelled.
3. **Incremental, idempotent ingestion.** Any request can be retried safely.

## Components

| Layer | Location | Notes |
| --- | --- | --- |
| Pages (React Server Components) | `src/app/(app)/**/page.tsx` | Read data synchronously via `src/lib/*`; every page calls `appContext()`/`requireUser()` first. |
| Server actions | `src/app/**/actions.ts` | Form handlers. Each begins with `requireUser()`. Redirect with `?ok=` / `?error=` flash messages. |
| API route handlers | `src/app/api/**/route.ts` | Import/status API (bearer token), health check, export and backup download (session). |
| Client components | `src/components/charts.tsx`, `TokenForms.tsx`, `Nav.tsx`, login/setup forms | The only client-side JavaScript. |
| Domain logic | `src/lib/**` | Plain TypeScript, framework-free, unit-tested. |
| Data access | functions taking a `DB` handle (`better-sqlite3`) | Synchronous SQL; no ORM. `getDb()` holds the process-wide connection. |
| iOS companion | `ios/VigorSync` | Swift/SwiftUI, HealthKit, BackgroundTasks. |

Authentication: `src/middleware.ts` (edge runtime) redirects page requests without a session cookie to `/login`. The real check happens server-side in `requireUser()`, because SQLite is not available at the edge. API routes are excluded from middleware: they authenticate themselves, and middleware would also cap request bodies at 10 MB.

## Data model

All tables are defined in `src/lib/db/migrations.ts`.

| Table | Purpose |
| --- | --- |
| `users`, `sessions` | Single account. Scrypt password hash. Sessions are stored as SHA-256 of the cookie token. |
| `api_tokens` | Ingestion tokens: SHA-256 hash, display prefix, `revoked_at`. |
| `settings` | JSON key/value store, validated by zod schemas in `src/lib/settings.ts`. The dashboard layout (`dashboardLayout`: ordered widget keys per zone `left`/`right`/`below`; absent = hidden) lives here. |
| `health_samples` | Every imported sample: `type` (metric key), `value` in canonical unit, `category` (sleep stage), `start_ms`/`end_ms`, `source` (integration that delivered it), `source_name` (app/device that recorded it), `external_id` (unique), `content_hash`, `deleted_at`. |
| `workouts` | Apple Health workout summaries and Hevy workouts (`source = 'hevy'`). |
| `exercises`, `exercise_aliases` | Canonical exercises plus aliases created by merges. `kind` is inferred unless `kind_locked`. |
| `workout_exercises`, `exercise_sets` | Exercise-level detail (from Hevy). |
| `measurement_types`, `body_measurements` | Built-in and custom manual measurements, with full history. |
| `import_runs` | One row per import attempt (health or Hevy): status, counts, errors, rejection details. |
| `sync_cursors` | Last acknowledged cursor per `(source, scope)`, e.g. a HealthKit anchor per type. |
| `sync_client_status` | Queue and error state reported by the iPhone companion. |
| `weekly_recaps`, `workout_ratings`, `sleep_summaries` | Cached Gemini output, per ISO week+scope (`week_start, scope` PK), per workout (`workout_id` PK) and per sleep night (`night` PK) respectively: the structured response, `prompt` (exact data sent, for transparency), `model`. Only ever written by an explicit user action — see "AI recap, workout rating and sleep summary" below. |

### Conventions

- **Timestamps:** UTC epoch milliseconds. Incoming timestamps must carry an offset; ambiguous local times are rejected. Hevy CSV wall-clock times are the one exception, interpreted in the configured time zone.
- **Time zones:** "days" are local calendar days in the user's IANA zone (Settings → Application). See `src/lib/time.ts`.
- **Units:** each metric has a canonical unit (`src/lib/metrics/catalog.ts`). Incoming units are converted by `toCanonical` in `src/lib/units.ts`, and display conversion happens only in the UI. Body measurements are stored in cm, kg or %.
- **Source attribution:** `source` is the integration (`vigor-ios`, `apple-shortcuts`, `demo`, …). `source_name` is the recording app or device (`Apple Watch`, a food app). Both are preserved and shown.
- **Soft deletion:** synced rows get `deleted_at` instead of being removed, so a late re-send of a deleted sample is recognised and the deletion stays auditable. *Settings → Data → Delete* removes rows permanently.

## Ingestion pipeline (`src/lib/ingest/health-import.ts`)

1. The envelope is validated strictly. Failure returns `422`, and nothing is stored except an `import_runs` row with status `rejected`.
2. **Replay check:** if an earlier run had the same `source` + `syncId` + SHA-256 of the body and succeeded, its stored summary is returned (`replayed: true`).
3. One transaction applies:
   - **Samples:** each one is validated and normalised individually. Invalid samples are rejected with a reason and do not abort the batch. Each sample has an `external_id`: the supplied id (a HealthKit UUID), or `derived:<sha256(source, type, category, start, end, value, sourceName)>`. Upsert outcome:
     - new → **accepted**;
     - same id, same `content_hash` → **skipped**;
     - same id, different content, or previously deleted → **updated** (a correction or reappearance).
   - **Workouts:** the same procedure.
   - **Deletions** (`deleted[]`): soft-delete by external id. Unknown ids count as skipped, so repeats are safe.
   - **Replace windows** (`replaceWindows[]`): for id-less sources. Inside `[startAt, endAt)`, samples of that type *from the same source* that were not in this payload are soft-deleted. Windows are capped at 62 days so a mistake cannot wipe history.
   - **Cursors:** upserted only if the transaction commits.
4. The run row is finalised with its counts.

Daily summaries are never stored, so a correction or late sample changes them on the next page load.

## Aggregation (`src/lib/aggregation/`)

`aggregate.ts` holds pure functions; `series.ts` loads data and applies them.

| Aggregation | Used for | Rule |
| --- | --- | --- |
| `sum` + `max-source` | steps, distance, energy, exercise minutes, flights, stand hours | Per local hour, keep the source with the largest total, then sum the hours. If any sample that day is longer than one hour (e.g. a daily total from a Shortcut), use per-day per-source maxima instead. This prevents iPhone + Watch double counting. |
| `sum` + `sum-all` | nutrition, water | Sum every entry (each meal is logged once). |
| `avg` | heart rate, HRV, SpO₂, temperature, blood pressure, glucose | Daily mean, with min and max. |
| `latest` | weight, height, body fat, lean mass, BMI, VO₂ max | Last reading of the day. Manual body measurements (weight, height, body fat, lean mass) are merged in as source "Manual entry". |
| `sleep` | sleep analysis | Samples are grouped into sleep days (18:00–18:00 local, labelled by the wake-up date). Each stage's intervals are merged across sources; asleep = union of all asleep stages; in bed = union of `in_bed`. "Unspecified" is shown only when there is no staged data. |

Period values (dashboard tiles) are the mean of daily values over days **with data**, or the latest reading for `latest` metrics. Trends compare against the immediately preceding period of equal length. "Days with data" is always shown next to averages.

## Training (`src/lib/training/`)

- `hevy-import.ts` parses Hevy's CSV (metric and imperial variants, several timestamp formats). Workouts are keyed by `hevy:` + hash(title, start_time). A changed workout has its exercises and sets replaced. Optionally, workouts missing from a complete export are removed.
- Exercises resolve through `exercise_aliases`, then by normalised name, or are created. `inferKind()` classifies by name and data (`assisted` from the name; weight + reps → weighted; reps only → bodyweight; distance; duration). Users can lock a kind.
- `calculations.ts`: Epley e1RM for working sets of 1–12 reps; volume = Σ weight × reps over working sets for weighted kinds; assisted exercises track the least assistance. Warm-up sets are excluded from stats.
- `listWorkouts()` links each Hevy workout with the Apple Health workout covering more than 50% of the same time, so one session is not listed twice.

## Calorie goal (`src/lib/health/calorie-goal.ts`)

- Pure functions, no DB access: `mifflinStJeorBmr`, `estimateTdee`, `planWeightGoal`. The page (`src/app/(app)/calorie-goal/page.tsx`) supplies the inputs.
- TDEE prefers measured 30-day averages of `active_energy`/`basal_energy` (via `getMetricSummary`, so it's deduplicated the same way the rest of the app is) when at least 7 of those days have data; otherwise it falls back to the Mifflin-St Jeor formula, labelled as estimated rather than measured.
- The goal (target weight, weekly pace, activity level) lives in `settings.weightGoal` — no new table.
- Direction (lose/gain) is derived from target vs. the latest logged weight at render time, not stored, so it stays correct as weight changes.
- Safety floor: 1.2× BMR when computable, else a sex-based absolute minimum (1200/1500 kcal) — a warning is shown rather than silently capping the target.

## AI recap, workout rating and sleep summary (`src/lib/ai/`)

- The one sanctioned exception to "no external network calls" (goal 2 / invariant 9) — `gemini.ts` is the only module that calls `fetch` to an external host, and only when the user explicitly clicks Generate or Regenerate on `WeeklyRecapCard` (Dashboard, Today, Training), `WorkoutRatingCard` (a workout's own detail page) or `SleepSummaryCard` (a sleep night's own detail page, `/metrics/sleep_analysis/[night]` — each night in the Nights table links there). Nothing runs automatically or on a schedule.
- All three features share the same shape, kept in separate files on purpose: a context builder (DB → structured JSON, canonical units), a pure prompt formatter (unit-converting, fully testable without the network), and `callGemini` in `gemini.ts` (JSON mode: `responseMimeType: "application/json"`), with the response validated against a Zod schema (`parseJsonResponse`) — a malformed response is a thrown error, never silently coerced into something that looks plausible.
- `weekly-recap.ts` has two scopes sharing one DB table (`weekly_recaps`, keyed by `(week_start, scope)`): `"full"` (training+sleep+nutrition+weight; `{ summary, goodThings, badThings, suggestion, sleepByNight }`, shown on Dashboard and Today) and `"training"` (training facts only — sleep/nutrition data isn't even sent to the model; `{ summary, goodThings, badThings, suggestion }`, shown on the Training page, scoped to whichever week the "Workouts per week" bar chart has selected, defaulting to last calendar week).
- `workout-rating.ts`: `buildWorkoutRatingContext` gathers one workout's own data plus comparisons Vigor itself computes — whether a set is a new all-time e1RM PR, and how this session's volume (strength) or pace/distance (cardio) compares to the athlete's last 8 similar sessions. The model only classifies (`"strong" | "solid" | "light" | "off"`) and narrates from those facts; it never computes the comparison itself.
- `sleep-summary.ts`: `buildSleepSummaryContext` gathers one night's own stats plus the athlete's average asleep time over the prior 14 nights (excluding this one); the model returns a short `{ summary }`.
- The model is instructed to only state facts present in the JSON and to say plainly when data is missing, rather than guessing — but this is a prompt instruction, not a guarantee; treat the output as generated commentary, not as a source of truth the way the rest of the app's numbers are.
- The exact prompt sent is cached alongside the response (`weekly_recaps`, `workout_ratings` keyed by `workout_id`, `sleep_summaries` keyed by `night`, all upserted on regenerate) and shown in a collapsed "What was sent to Gemini" disclosure on each card, so what left the server is never a black box.
- Requires `GEMINI_API_KEY` in `.env`. Without it, the cards show a setup message instead of a non-functional button. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite` (free tier as of this writing — confirm current pricing/model names at https://aistudio.google.com before changing).

## Adding things

- **A new health metric:** add a `MetricDef` to `src/lib/metrics/catalog.ts` (key, canonical unit, aggregation). If needed, add unit aliases to `src/lib/units.ts` and a HealthKit mapping to `ios/VigorSync/Sources/HealthTypes.swift`. No migration is needed. Add a test in `tests/`.
- **A new import source:** produce the import contract (`docs/import-api.md`) with a distinct `source` id. Server-side adapters (e.g. a future Apple Health `export.zip` importer) should call `importHealthPayload` in batches rather than writing tables directly, so they get deduplication and history for free.
- **A schema change:** append a migration. Update the export table list in `src/lib/data/manage.ts` if the table holds user data.
- **A dashboard widget:** add a `WidgetDef` to `WIDGETS` in `src/lib/dashboard-layout.ts`. A `tile` only needs its metric key; a `panel` also needs a renderer in `panels` in `src/app/(app)/page.tsx`. New widgets start hidden until the user places them (or add them to `DEFAULT_LAYOUT`).

## Background processing

There is none on the server. Aggregates are computed on read, backups are user-triggered (or done by your host's scheduler), and synchronisation is pushed by the phone. In Docker and Kubernetes the container is just the web server; no cron or sidecar is required.
