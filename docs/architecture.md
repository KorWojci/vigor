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
| `exercise_media` | Cached ExerciseDB match per exercise: matched name/score, muscle and body-part data, and the filename of the demo GIF stored under `<data>/exercise-media/`. Populated offline by `scripts/sync-exercise-media.ts`, never written at request time. Not included in exports (it's a re-fetchable third-party cache, not user data). |

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
- **Exercise media** (`src/lib/training/exercise-media.ts`, `src/lib/training/muscles.ts`): a demo GIF and muscle data per exercise, matched against the free [ExerciseDB](https://oss.exercisedb.dev) catalog by name — exact match first, else the closest match by word-overlap (`nameSimilarity`/`findBestMatch`). `MATCH_THRESHOLD` (0.55) was picked by inspecting real matches: everything at or below 0.50 turned out to be the wrong exercise (shared only an incidental word), everything at 0.57+ was the same exercise under a different name. Below it, no image is shown rather than a bad guess (invariant 1). `scripts/sync-exercise-media.ts` is the *one* deliberate, offline exception to "no external network calls" (invariant 9): run by hand (`npm run sync:exercise-media`, add `--force` to re-check existing matches against a changed threshold — it deletes any cached match that no longer clears it), never during a request, in the same spirit as the `cities.json` regeneration note in `src/lib/geo/nearest-city.ts`. The GIF files themselves live under `<data>/exercise-media/`, outside git and outside exports (they're a re-fetchable third-party cache, not user data), and are served to the browser only through the session-authenticated `/api/exercise-media/[exerciseId]` route — Vigor never links to the third party at render time. The free tier is non-commercial with required attribution, shown in the UI as `ATTRIBUTION`. The "muscles trained" breakdown (`src/components/MuscleLoad.tsx`) is plain ranked bars — neither Hevy's nor Strava's API exposes real muscle-fatigue data (checked directly: both are logged-set totals under a different name, the same kind of estimate this computes), so there was nothing to integrate and no reason for a body diagram.

## Adding things

- **A new health metric:** add a `MetricDef` to `src/lib/metrics/catalog.ts` (key, canonical unit, aggregation). If needed, add unit aliases to `src/lib/units.ts` and a HealthKit mapping to `ios/VigorSync/Sources/HealthTypes.swift`. No migration is needed. Add a test in `tests/`.
- **A new import source:** produce the import contract (`docs/import-api.md`) with a distinct `source` id. Server-side adapters (e.g. a future Apple Health `export.zip` importer) should call `importHealthPayload` in batches rather than writing tables directly, so they get deduplication and history for free.
- **A schema change:** append a migration. Update the export table list in `src/lib/data/manage.ts` if the table holds user data.
- **A dashboard widget:** add a `WidgetDef` to `WIDGETS` in `src/lib/dashboard-layout.ts`. A `tile` only needs its metric key; a `panel` also needs a renderer in `panels` in `src/app/(app)/page.tsx`. New widgets start hidden until the user places them (or add them to `DEFAULT_LAYOUT`).

## Background processing

There is none on the server. Aggregates are computed on read, backups are user-triggered (or done by your host's scheduler), and synchronisation is pushed by the phone. In Docker and Kubernetes the container is just the web server; no cron or sidecar is required.
