# Import API (v1)

The implementation lives in `src/lib/ingest/schema.ts` (contract) and `src/lib/ingest/health-import.ts` (processing). The route handlers are in `src/app/api/v1/health/`.

## Authentication

Every request needs an ingestion token in the `Authorization` header:

```
Authorization: Bearer vgr_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- Create tokens in **Settings → Integrations** or on the **Apple Health sync** page. A token is displayed once and stored only as a SHA-256 hash.
- Tokens can be revoked or rotated; rotation revokes the old token and issues a new one with the same name.
- Tokens are never accepted in the URL or query string.
- After 30 failed authentication attempts from one IP within a minute, Vigor answers `429` for that minute.

## `POST /api/v1/health/import`

Content type: `application/json`. Maximum body size: `VIGOR_MAX_IMPORT_BYTES` (default 10 MiB). Larger syncs must be split into several requests.

### Envelope

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes | Must be `1`. |
| `source` | string | yes | Integration id, `[A-Za-z0-9._-]`, ≤ 64 characters. E.g. `vigor-ios`, `apple-shortcuts`. Deduplication by content, replace windows and cursors are all scoped to it. |
| `syncId` | string | yes | ≤ 128 characters, unique per sync attempt. A retry of the *byte-identical* body with the same `syncId` returns the stored result. |
| `generatedAt` | timestamp | yes | When the client built the payload. |
| `device` | object | no | `name`, `model`, `systemVersion`, `appVersion`, `timeZone`. Informational only. |
| `samples` | array | no | ≤ 50,000 items. |
| `workouts` | array | no | ≤ 2,000 items. |
| `deleted` | array | no | ≤ 50,000 items: `{ "externalId": "…", "kind": "sample" \| "workout" }` (kind defaults to `sample`). |
| `replaceWindows` | array | no | ≤ 200 items: `{ "type", "startAt", "endAt" }`. See below. |
| `replaceToday` | boolean | no | Default `false`. See below — an alternative to building `replaceWindows` yourself. |
| `cursors` | array | no | ≤ 200 items: `{ "scope": "…", "value": "opaque ≤ 64 KiB" }`. Stored only if the import succeeds. |

**Timestamps** must be ISO 8601 with a UTC offset: `2026-10-20T08:00:00Z`, `2026-10-20T10:00:00+02:00`, or `2026-10-20 10:00:00 +0200` (as Shortcuts renders it). Timestamps without an offset are rejected rather than guessed.

### Sample

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | A metric key from the table below. |
| `value` | number | yes, except sleep | In `unit`. Text is accepted for clients that can't type their JSON (Shortcuts): `"80.4"`, `"80,4"`, `"1 234"`. Ambiguous text such as `"1,234"` is rejected. For sleep, a text `value` is used as the `category` when `category` is absent. |
| `unit` | string | yes, except count/sleep | Converted to the canonical unit. |
| `category` | string | sleep only (ignored for other types) | `in_bed`, `awake`, `asleep_unspecified`, `asleep_core`, `asleep_deep`, `asleep_rem`. Also accepted: Shortcuts labels (`In Bed`, `Core`, `Deep`, `REM`, `Asleep`, `Awake`) and HealthKit names (`HKCategoryValueSleepAnalysisAsleepREM`). |
| `startAt` | timestamp | yes | |
| `endAt` | timestamp | no | Defaults to `startAt`. Must not be before it. |
| `sourceName` | string | no | The app or device that recorded the sample. Recommended: it is used to avoid double counting. |
| `sourceBundleId`, `device` | string | no | Kept for attribution. |
| `externalId` | string | no | A stable unique id, e.g. the HealthKit UUID. **Strongly recommended.** Without it, Vigor derives the id from the content (see *Deduplication*). |
| `metadata` | object | no | Flat map of strings, numbers, booleans and nulls. |

Samples are rejected individually if the type is unknown, the unit cannot be converted, the value is missing, negative, or a percentage above 100, or the time is malformed, more than a day in the future, or before 1990. The rest of the batch is stored.

### Workout

`activityType` (required), `startAt`, `endAt` (required), and optionally `title`, `durationSeconds`, `energyKcal`, `distanceMeters`, `avgHeartRate`, `maxHeartRate`, `sourceName`, `externalId`, `metadata`, `route`.

`route`: an optional array of GPS points, ≤ 3000: `{ "t": 12.5, "lat": 52.4069, "lon": 16.9299, "ele": 68.4 }`. `t` is seconds since the workout's own `startAt` (not a timestamp); `ele` (metres) is optional. Points don't need to be evenly spaced, but should be sorted or close to it. There's no basemap — Vigor draws the route as a plain line, and separately looks up the nearest city from a small bundled offline list (no network call) to label where the workout happened.

### Metric types and units

| Key | Canonical unit | Also accepted |
| --- | --- | --- |
| `step_count`, `flights_climbed` | count | `steps`, empty |
| `distance_walking_running` | m | km, mi, ft, yd, cm |
| `active_energy`, `basal_energy`, `dietary_energy` | kcal | Cal, kJ, J |
| `exercise_time` | min | s, h |
| `stand_hours` | hr | h, count |
| `heart_rate`, `resting_heart_rate`, `walking_heart_rate`, `heart_rate_recovery` | bpm | count/min, beats/min |
| `heart_rate_variability` | ms | s |
| `oxygen_saturation`, `body_fat_percentage` | % | `fraction` (0–1). A `%` value ≤ 1 is treated as a fraction. |
| `respiratory_rate` | breaths/min | count/min |
| `vo2_max` | ml/kg/min | mL/(kg·min) |
| `sleep_analysis` | min (derived from duration) | – |
| `body_mass`, `lean_body_mass` | kg | g, lb, st |
| `height`, `waist_circumference` | cm | m, mm, in, ft |
| `body_mass_index` | kg/m² | count |
| `dietary_protein`, `dietary_carbohydrates`, `dietary_fat`, `dietary_fiber`, `dietary_sugar`, `dietary_sodium`, `dietary_caffeine` | g | mg, mcg, kg, oz |
| `dietary_water` | mL | L, fl_oz_us, cup_us |
| `body_temperature` | °C | degC, degF, °F |
| `blood_pressure_systolic`, `blood_pressure_diastolic` | mmHg | – |
| `blood_glucose` | mg/dL | mmol/L |

Units are matched case-insensitively. The authoritative list is `src/lib/units.ts` and `src/lib/metrics/catalog.ts`.

### Deduplication, corrections and deletions

- **With `externalId`:** the id is the identity. Re-sending is a no-op (`skipped`). Re-sending with different content updates the row (`updated`).
- **Without `externalId`:** the id is `derived:` + SHA-256 of (source, type, category, start, end, value, sourceName). Exact re-sends are skipped. A *changed* value looks like a new sample, which is why id-less sources should declare replace windows.
- **`deleted[]`:** soft-deletes by `externalId` (HealthKit `HKDeletedObject` UUIDs).
- **`replaceWindows[]`:** declares that the payload contains *all* samples of `type` from this `source` with `startAt ≤ start < endAt`. Earlier samples from the same source in that window that are not in the payload are soft-deleted. Use it only when the client really sent everything in the window (e.g. a Shortcut with no result limit). Samples from other sources are never touched. Maximum window: 62 days.
- **`replaceToday`:** a convenience for a client that always queries "today" rather than a rolling window (e.g. a Shortcut whose *Find Health Samples* filter is "Start Date is today" instead of "in the last N hours" — this needs no `WindowStart` variable and no per-type `Windows` list to build). When `true` **and `replaceWindows` is not sent at all**, the server builds one replace window per `type` that has at least one sample **from today** in this request (start between local midnight and `generatedAt`), spanning from local midnight to `generatedAt`. A type present only through older samples (a backfill, or a batch mixing older days with today) gets no window, so its samples already stored for today are never deleted by accident; older days are never touched by `replaceToday`. "Local" means the UTC offset `generatedAt` itself carries, not the server's time zone or UTC — a payload generated at `23:50+02:00` uses that day's midnight in `+02:00`, not in UTC. A type with no sample from today this run gets no implicit window (nothing is inferred as "today's complete, empty state" for it — exactly like the per-type guard you'd build by hand for `replaceWindows`). If `replaceWindows` is present (even as a window for a different type), `replaceToday` is ignored entirely — an explicit window always wins and nothing is inferred alongside it.

### Response — `200 OK`

```json
{
  "ok": true,
  "importRunId": 42,
  "syncId": "…",
  "replayed": false,
  "status": "success",
  "summary": { "received": 120, "accepted": 100, "updated": 3, "skipped": 16, "rejected": 1, "deleted": 2 },
  "rejections": [{ "kind": "sample", "index": 7, "reason": "unsupported metric type 'foo'" }],
  "cursorsStored": 1,
  "serverTime": "2026-10-20T08:00:01.234Z"
}
```

`status` is `partial` when anything was rejected. `received` counts samples + workouts + deletions. At most 100 rejections are listed.

### Errors

| Status | Meaning | Retry? |
| --- | --- | --- |
| 400 | Body is not JSON | No (fix the client) |
| 401 | Missing or invalid token | No (fix the token) |
| 413 | Body too large | Split into smaller batches |
| 422 | Envelope invalid; `issues` lists the problems | No |
| 429 | Too many failed authentications | After a minute |
| 500 | Unexpected error; the transaction was rolled back | Yes, safely |

Error bodies are `{ "ok": false, "error": "…", "issues"?: [...] }`. Authenticated failures are recorded in the import history.

## `GET /api/v1/health/status?source=<id>`

Tests the connection and token. Returns the server's sync state and the cursors last acknowledged for `source`, so a reinstalled client can resume.

```json
{ "ok": true, "serverTime": "…", "schemaVersion": 1, "targetIntervalMinutes": 60, "state": "ok",
  "lastSuccessAt": "…", "lastAttemptAt": "…", "cursors": [{ "scope": "step_count", "value": "…", "updatedAt": "…" }] }
```

`state` is one of `never`, `ok`, `stale` (no success within `VIGOR_STALE_AFTER_HOURS`) or `failing`.

## `POST /api/v1/health/status`

Lets the companion report its local state:

```json
{ "source": "vigor-ios", "pendingSamples": 0, "lastAttemptAt": "…", "lastSuccessAt": "…", "lastError": null }
```

## `GET /api/healthz`

Unauthenticated liveness and readiness check: `{ "ok": true, "schemaVersion": 1 }`. It reveals no personal data.

## Versioning

Breaking changes require a new `schemaVersion` (and, if needed, `/api/v2`). Additive optional fields may be added to v1. Unknown fields are ignored.
