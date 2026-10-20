# Notes for coding agents and contributors

Start with `README.md`, then `docs/architecture.md`. This file lists the rules that are easy to break.

## Commands

```bash
npm install
npm run check            # lint + typecheck + tests — run before every commit
npm run dev              # http://localhost:3000 (uses ./data/vigor.db)
npm run db:seed-demo     # synthetic data for manual testing
npm run build            # must succeed; CI also builds the Docker image
```

Tests use in-memory SQLite (`tests/helpers.ts → testDb()`). Put new tests in `tests/*.test.ts`.

## Invariants

1. **Never fabricate data.** No placeholder numbers in the UI. A missing value is `null` and renders as "no data" or "—". Demo data must stay labelled (`source = 'demo'`, `SYNTHETIC`).
2. **Never commit personal data or secrets.** Fixtures and samples are synthetic. Respect `.gitignore`.
3. **Imports are idempotent.** Every write path keys on a stable external id and is safe to retry. Use `importHealthPayload` for any new health source instead of writing to `health_samples` directly.
4. **Canonical units in storage, UTC ms timestamps, local days via `src/lib/time.ts`.** Convert units only at the edges (`toCanonical` on input, `toDisplay` in the UI).
5. **No stored aggregates.** Daily totals are computed on read. If you add caching, it must be invalidated by imports, corrections and deletions.
6. **Migrations are append-only** (`src/lib/db/migrations.ts`).
7. **Every page and server action calls `requireUser()`/`appContext()`.** The middleware is only a convenience redirect.
8. **The import contract is versioned.** Additive optional fields are fine; breaking changes need `schemaVersion: 2`. Update `docs/import-api.md` together with `src/lib/ingest/schema.ts`.
9. **No external network calls** from server or client (no CDNs, fonts or analytics).

## Where things live

| Task | File(s) |
| --- | --- |
| Add a health metric | `src/lib/metrics/catalog.ts` (+ `ios/VigorSync/Sources/HealthTypes.swift`) |
| Change aggregation | `src/lib/aggregation/aggregate.ts` (pure, unit-tested) |
| Import API | `src/app/api/v1/health/*`, `src/lib/ingest/*` |
| Hevy import / training math | `src/lib/training/*` |
| Dashboard figure | `src/components/VitruvianFigure.tsx` (original procedural SVG — do not replace it with a reproduction of the artwork) |
| Styles / theme tokens | `src/app/globals.css` (CSS variables, light and dark) |
| Settings schema | `src/lib/settings.ts` |

## Known gaps / good next tasks

- `export.zip` importer for old Apple Health history (stream the XML, then call `importHealthPayload` in batches).
- Hevy API integration (API key, Hevy Pro).
- The iOS companion has not been compiled in CI (no macOS runner). A macOS CI job running `xcodegen && xcodebuild` would close that gap.
- Optional scheduled backups (would need an in-process timer; keep it simple).
