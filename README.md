# Vigor

**A self-hosted, private dashboard for your health, training and body progress.**

Vigor collects Apple Health data from your iPhone, Hevy workout exports, nutrition logged by other apps, and body measurements you enter by hand. It shows them together around an original line drawing inspired by Leonardo da Vinci's *Vitruvian Man*. Everything runs on your own machine: one container and one SQLite file, with no cloud services and no telemetry.

- **Dashboard.** Weight, body composition, activity, sleep, heart rate, HRV, VO₂ max, nutrition and training. Each value shows its unit, date and source, and its trend against the previous period. Body regions on the figure link to their history.
- **Health metrics.** 34 metric types with correct aggregation: daily totals without double counting across devices, daily averages with min/max, latest readings, and sleep stages merged across sources. Missing data is shown as missing, never as zero.
- **Apple Health sync.** An authenticated, idempotent, incremental import API. It handles corrections, deletions, late samples and retries. It works with a native iPhone companion app (hourly target) or with Apple Shortcuts.
- **Training.** Imports Hevy CSV exports. For each exercise it shows sets, estimated 1RM, volume, personal records and progress charts. It supports weighted, bodyweight, assisted, duration and distance exercises, and links Hevy workouts with the matching Apple Health workouts.
- **Body measurements.** 17 built-in measurements plus your own custom ones, in metric or imperial units. History is kept in full.
- **Data ownership.** JSON export, consistent backups, restore, and permanent deletion.

> All sample data in this repository is synthetic. See [`samples/`](samples/README.md).

---

## Contents

1. [Quick start (Docker)](#quick-start-docker)
2. [Local development](#local-development)
3. [Architecture](#architecture)
4. [Configuration](#configuration)
5. [Database and migrations](#database-and-migrations)
6. [Reaching Vigor from your iPhone](#reaching-vigor-from-your-iphone)
7. [Apple Health synchronisation](#apple-health-synchronisation)
8. [Hevy import](#hevy-import)
9. [Import API](#import-api)
10. [Tests, linting and type checking](#tests-linting-and-type-checking)
11. [Backup, restore and upgrade](#backup-restore-and-upgrade)
12. [Troubleshooting](#troubleshooting)
13. [Project status and known limitations](#project-status-and-known-limitations)

---

## Quick start (Docker)

Prerequisites: Docker with Compose v2.

```bash
git clone <this repository> vigor && cd vigor
cp .env.example .env          # optional — defaults work
docker compose up -d --build
```

Open <http://localhost:3000>. On first start Vigor asks you to create the account that protects your data. Alternatively, set `VIGOR_ADMIN_PASSWORD` in `.env` before the first start.

Then:

1. **Settings → Application:** set your time zone. Days, nights and Hevy times are computed in it.
2. **Apple Health sync:** create an ingestion token and set up the iPhone (see [below](#apple-health-synchronisation)).
3. **Settings → Training imports:** upload a Hevy export.
4. **Settings → Data → Load demo data** if you want to explore with synthetic data first.

Data is stored in the Docker volume `vigor-data`, mounted at `/data`. It survives `docker compose down`, container recreation and image upgrades. `docker compose down -v` deletes it.

Kubernetes: see [`deploy/k8s/vigor.yaml`](deploy/k8s/vigor.yaml) (Deployment + PersistentVolumeClaim) and [`docs/deployment.md`](docs/deployment.md).

## Local development

Prerequisites: Node.js 20.9+ (22 recommended) and npm. `better-sqlite3` ships prebuilt binaries; if none matches your platform it compiles, which needs Python 3 and a C++ toolchain.

```bash
npm install
npm run db:seed-demo           # optional: 120 days of SYNTHETIC data into ./data/vigor.db
npm run dev                    # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build / server (`.next/standalone/server.js` is what Docker runs) |
| `npm test` | Unit and integration tests (Vitest, in-memory SQLite) |
| `npm run lint` | ESLint (Next.js rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | All three above |
| `npm run db:migrate` | Apply migrations to `$VIGOR_DATA_DIR/vigor.db` (also automatic at start-up) |
| `npm run db:seed-demo [-- --remove]` | Load or remove synthetic demo data |

New to the codebase? Read [`docs/architecture.md`](docs/architecture.md) first, then [`AGENTS.md`](AGENTS.md).

## Architecture

```
iPhone ──(HTTPS/HTTP on LAN, Bearer token)──► POST /api/v1/health/import ─┐
  • Vigor Sync companion app (HealthKit anchored queries)                 │
  • or Apple Shortcuts                                                    ▼
Browser ──(session cookie)──► Next.js app (React server components) ──► SQLite (/data/vigor.db)
Hevy CSV export ──(upload in Settings)──────────────────────────────────┘
```

- **One deployable:** a Next.js 15 (App Router) server in TypeScript. Pages are server-rendered React; charts are client components (Recharts).
- **SQLite** via `better-sqlite3`, in WAL mode, with SQL migrations in `src/lib/db/migrations.ts`. It suits a single-user deployment, and backups are one file.
- **No background workers.** Aggregates (daily totals, sleep nights, personal records) are computed on read from raw records. Late or corrected data is therefore reflected immediately, with no caches to invalidate.
- **Optional iOS component** (`ios/VigorSync`). A browser or a Docker container cannot read HealthKit, so something has to run on the iPhone.

```
src/
  app/                    Next.js routes: pages, server actions, API route handlers
    (app)/                authenticated pages (dashboard, metrics, nutrition, training, body, integrations, settings)
    api/v1/health/        import + status API (bearer token)
    api/healthz           health check
  components/             UI components (VitruvianFigure, charts, tiles)
  lib/
    db/                   connection, migrations, seed of built-in rows
    ingest/               import contract (zod), import processor, sync status
    aggregation/          pure aggregation functions + series queries
    metrics/catalog.ts    metric definitions (add new metric types here)
    training/             Hevy CSV parser/importer, 1RM & volume calculations, queries
    body/                 measurement types and repository
    auth/                 password hashing, sessions, ingestion tokens
    data/                 backup, restore, export, deletion
    units.ts, time.ts     unit conversion, time-zone handling
ios/VigorSync/            Swift companion app (XcodeGen project)
deploy/k8s/               Kubernetes example
docs/                     detailed documentation
tests/                    Vitest suites (synthetic data only)
```

Details: [`docs/architecture.md`](docs/architecture.md).

## Configuration

Set these through environment variables (`.env` for Compose; a Secret or env vars for Kubernetes). [`.env.example`](.env.example) lists them with placeholders.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOSTNAME` | `0.0.0.0` in Docker | Bind address |
| `VIGOR_DATA_DIR` | `./data` (`/data` in Docker) | Database and backups directory. **Mount persistent storage here.** |
| `VIGOR_DB_PATH` | `$VIGOR_DATA_DIR/vigor.db` | Explicit database file |
| `VIGOR_ADMIN_PASSWORD` | — | Creates the user `admin` on first start if no user exists. Remove it afterwards. |
| `VIGOR_SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |
| `VIGOR_MAX_IMPORT_BYTES` | `10485760` | Maximum size of one import request |
| `VIGOR_STALE_AFTER_HOURS` | `3` | When the dashboard flags Apple Health data as outdated |
| `TZ` | `UTC` | Default time zone until one is chosen in Settings |

Everything else is in the in-app **Settings**: profile, units, time zone, theme, default range, dashboard tiles, chart options, tokens and sync interval.

## Database and migrations

- The database is created and migrated automatically on first access. `npm run db:migrate` does the same explicitly.
- Before applying migrations to an existing database, Vigor writes a snapshot to `<data dir>/backups/vigor-pre-migration-v<N>-<time>.db`.
- Migrations are append-only. Add a new entry to `src/lib/db/migrations.ts`; never edit a shipped one.
- Conventions: timestamps are UTC epoch milliseconds; values are stored in each metric's canonical unit; synced rows are soft-deleted (`deleted_at`).

## Reaching Vigor from your iPhone

The iPhone must reach the server over your local network:

1. Find the server's LAN address (e.g. `192.168.1.20`). Use `ip addr` on Linux, `ipconfig` on Windows, or System Settings → Network on macOS.
2. Use `http://192.168.1.20:3000` on the phone, never `localhost`. Allow port 3000 through the host firewall.
3. Keep the phone on the same Wi-Fi. Guest networks often isolate clients.

**Do not expose Vigor or its import endpoint directly to the internet.** For access outside your home, use a VPN (WireGuard, Tailscale) or a reverse proxy with HTTPS and additional authentication. HTTPS details and reverse-proxy examples are in [`docs/deployment.md`](docs/deployment.md#https-and-reverse-proxies). The security model is in [`docs/security-and-privacy.md`](docs/security-and-privacy.md).

## Apple Health synchronisation

**Decision summary** (full evaluation: [`docs/apple-health-sync.md`](docs/apple-health-sync.md)):

| Option | Hourly? | Incremental | Deletions | Effort |
| --- | --- | --- | --- | --- |
| **B. Vigor Sync companion app** (recommended) | Targeted via HealthKit background delivery (`.hourly`) + background refresh. iOS decides actual timing. | Yes: HealthKit anchors, sample UUIDs | Yes | Needs a Mac with Xcode to install |
| **A. Apple Shortcuts** (supported alternative) | Only by creating one *Time of Day* automation per hour; there is no hourly repeat | Overlapping time window + content deduplication | Via declared `replaceWindows` | No build step |
| C. Full `export.zip` / third-party exporters | No (manual) / depends on vendor | No / varies | No / varies | Not implemented. Documented as alternatives. |

Under both options, the phone **pushes** data to `POST /api/v1/health/import` with a bearer token. Vigor stores per-source cursors and records every import run. The Apple Health sync page shows the last successful sync, the last attempt, counts, pending changes reported by the phone, errors and a stale warning.

- Companion app setup: [`docs/apple-health-sync.md`](docs/apple-health-sync.md#setting-up-the-companion-app)
- Shortcuts setup: [`docs/apple-health-shortcuts.md`](docs/apple-health-shortcuts.md)

**Retry and frequency behaviour.** The companion advances its HealthKit anchor only after Vigor acknowledges a batch, so unsent changes stay queued on the phone and are retried on the next run. Shortcuts re-send an overlapping window each run. Retries never create duplicates: samples are keyed by HealthKit UUID or by a content hash, and a byte-identical retried request is answered from its stored result.

## Hevy import

In Hevy, go to Profile → Settings → Export & Import Data → Export Workouts. Then upload the CSV in **Settings → Training imports**. Re-importing is safe: workouts are matched by title and start time, and updated or skipped accordingly. Exercises with different names can be merged, and the old name becomes an alias. Vigor never asks for your Hevy password. Details: [`docs/hevy-import.md`](docs/hevy-import.md).

## Import API

`POST /api/v1/health/import` with `Authorization: Bearer vgr_…` and a JSON body:

```json
{
  "schemaVersion": 1,
  "source": "apple-shortcuts",
  "syncId": "2026-10-20T08:00:00Z",
  "generatedAt": "2026-10-20T08:00:00Z",
  "samples": [
    { "type": "step_count", "value": 842, "unit": "count",
      "startAt": "2026-10-20T07:00:00Z", "endAt": "2026-10-20T07:30:00Z",
      "sourceName": "Apple Watch", "externalId": "optional-unique-id" }
  ],
  "deleted": [{ "externalId": "…" }],
  "replaceWindows": [{ "type": "step_count", "startAt": "…", "endAt": "…" }],
  "cursors": [{ "scope": "step_count", "value": "opaque" }]
}
```

The response gives `accepted`, `updated`, `skipped`, `rejected` and `deleted` counts plus per-record rejection reasons. `GET /api/v1/health/status` tests the connection and returns stored cursors. The full contract, units, limits and error codes are in [`docs/import-api.md`](docs/import-api.md). The implementation is in `src/lib/ingest/`.

## Tests, linting and type checking

```bash
npm run check        # lint + typecheck + tests
```

The tests cover the import pipeline (idempotency, retries, corrections, deletions, replace windows, validation, unit conversion), aggregation (overlapping devices, time zones, sleep merging, missing days), the Hevy importer and training calculations, authentication and tokens, settings, measurements, sync status and data deletion. They use in-memory SQLite and synthetic data only. CI runs the same checks plus a production build (`.github/workflows/ci.yml`).

## Backup, restore and upgrade

- **Backup:** Settings → Data → *Create backup now* writes a consistent snapshot (`VACUUM INTO`) to `<data dir>/backups/` that you can download. From a shell: `docker compose exec vigor node -e "require('better-sqlite3')('/data/vigor.db').exec(\"VACUUM INTO '/data/backups/manual.db'\")"`. Copy backups off the machine.
- **Restore:** Settings → Data → *Restore*. Vigor validates the file, backs up the current database, swaps the file in and migrates it if needed. Alternatively, stop the container, replace `vigor.db` in the volume and delete the `vigor.db-wal` and `vigor.db-shm` files.
- **Export:** Settings → Data → *Download JSON export*.
- **Upgrade:** `git pull && docker compose up -d --build`. Migrations run on start after an automatic pre-migration snapshot.

Step-by-step procedures, including Kubernetes: [`docs/deployment.md`](docs/deployment.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| iPhone can't connect | Same network? LAN IP rather than `localhost`? Firewall? Local Network permission granted? See the Apple Health sync page → Troubleshooting. |
| `401` from the import API | Header must be `Authorization: Bearer <token>`. The token may have been revoked or rotated. |
| `422` | Read the `issues` in the response or in the sync page's import history. Timestamps need a UTC offset. |
| Dashboard says "Sync outdated" | No successful import within `VIGOR_STALE_AFTER_HOURS`. Check the phone's automation or background refresh. |
| A metric shows "No data imported" | Vigor never received that type. Enable it in the sync source and grant Health permission. |
| Login lockout | 8 failed logins per 15 minutes per IP. Wait, or restart the server. |
| Forgot password | `docker compose exec vigor node -e "require('better-sqlite3')('/data/vigor.db').exec('DELETE FROM users')"` removes the account but keeps all data. Then visit `/setup` to create a new one. |

## Project status and known limitations

- The **iOS companion app** (`ios/VigorSync`) uses only documented HealthKit and BackgroundTasks APIs. It **has not been compiled or run in this repository's CI**, which has no macOS or Xcode. Treat it as a reference implementation and expect small fixes on first build. The server side it talks to is fully tested.
- **Hourly sync is a target, not a guarantee.** iOS decides when background work runs, and Health data cannot be read while the phone is locked. Shortcuts have no hourly trigger.
- Shortcuts does not expose HealthKit sample UUIDs. Deletions are only mirrored inside windows the Shortcut declares complete (`replaceWindows`).
- Deduplicating activity across devices keeps the larger source per hour. This approximates, but is not identical to, Apple Health's own source-priority merge.
- Nutrition is read only through Apple Health. Food-tracking apps that don't share with Health, or don't share some fields, can't appear.
- Single-user by design. One SQLite file, so run a single replica.
- Not implemented yet: importing Apple Health `export.zip` for very old history (the companion app's configurable backfill covers initial setup), and a direct Hevy API integration (Hevy Pro API key).

## License

MIT
