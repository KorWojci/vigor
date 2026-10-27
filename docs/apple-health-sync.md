# Apple Health synchronisation

## The constraint

Apple Health data lives in HealthKit on the iPhone. It cannot be read by a website, by a server, or by anything in a Docker container. There is no web API and no iCloud API for it. Some component on the iPhone must therefore read HealthKit and **push** the data to Vigor. The requirement is to do this **incrementally, about every hour**, over the local network.

## Options evaluated

### Option A — Apple Shortcuts

A Shortcut uses *Find Health Samples* and *Get Contents of URL* to POST samples.

- ✅ No app to build or install; works on any iPhone.
- ❌ **No hourly schedule.** Personal automations offer *Time of Day* with daily, weekly or monthly repeats only. A single daily automation syncs once a day. Hourly sync needs **one automation per hour** (up to 24), each set to *Run Immediately*.
- ❌ HealthKit **sample UUIDs are not exposed**, nor are deletions or an incremental anchor. Incremental behaviour has to be emulated: query an overlapping recent window ("last 6 hours"), and let the server deduplicate by content.
- ❌ Health data is protected while the iPhone is locked, so automations running while it is locked can fail or return nothing.
- ❌ Building arrays of dictionaries in Shortcuts is slow for thousands of samples. High-frequency types (heart rate) make runs long.

### Option B — Native HealthKit companion app (**selected as primary**)

A small SwiftUI app, `ios/VigorSync`, reads HealthKit and posts to the import API.

- ✅ **True incremental sync:** `HKAnchoredObjectQuery` returns exactly the samples added *and the objects deleted* since an opaque anchor, including stable sample UUIDs.
- ✅ **Corrections and deletions:** in HealthKit, edits are delete + add, both of which the anchored query reports. They map directly to Vigor's `deleted[]` and upserts by UUID.
- ✅ **Background execution:** `HKHealthStore.enableBackgroundDelivery(for:frequency: .hourly)` combined with `HKObserverQuery` makes iOS wake the app when new data is written, at most about hourly per type. A `BGAppRefreshTask` requested every hour is the fallback.
- ✅ **Queue and retry:** the anchor is advanced only after Vigor confirms a batch with HTTP 2xx. Unsent changes therefore stay pending on the phone and are re-read and re-sent on the next run, whether that run is triggered by background delivery, background refresh, or opening the app.
- ❌ It must be built with Xcode on a Mac and installed with an Apple ID. A free account's provisioning profile expires after 7 days; a paid developer account lasts a year. TestFlight requires a paid account.
- ❌ **iOS decides when background work actually runs.** Typical behaviour is roughly hourly while the phone is used, less when it is idle, locked (protected data is unreadable), in Low Power Mode, or when Background App Refresh is off. Exact hourly execution cannot be guaranteed by any third-party app.

### Option C — Other supported routes

| Route | Assessment |
| --- | --- |
| Health app → *Export All Health Data* (`export.zip`) | Documented and complete, but manual and always the full history (often hundreds of MB). Not incremental and not schedulable. Suitable only as a one-off historical import (not yet implemented, see *Future work*). |
| Third-party exporter apps (e.g. "Health Auto Export") | Some offer scheduled REST exports. They are a closed-source dependency with a paid tier, their own JSON formats and scheduling still bound by iOS. They could be added later as an adapter that maps their format to the import contract. Not chosen as the primary path. |
| iCloud / CloudKit | Health data is end-to-end encrypted in iCloud with no public API. Not possible. |
| Apple Watch app | Same background constraints as the phone, more complexity. No benefit. |

### Decision

- **Primary: Option B, the companion app.** It is the only supported approach that provides real incremental cursors, deletions and stable identifiers with an hourly *target*.
- **Supported alternative: Option A, Shortcuts.** Kept for users without a Mac. Documented honestly: hourly needs one automation per hour, and deletions only via declared windows.
- **Server design is source-agnostic.** Both options use the same versioned import contract. Idempotency, cursors, replace windows, import statistics and staleness detection live on the server, so future sources plug in without changing the data model.

## How the pieces implement the requirements

| Requirement | Implementation |
| --- | --- |
| ~hourly sync | Companion: HealthKit background delivery `.hourly` + hourly `BGAppRefreshTask` + sync on app open. Shortcuts: per-hour automations. Target interval configurable in Settings (displayed and returned by the status API). |
| Track last success and cursor | `import_runs` (attempts, outcomes) and `sync_cursors` (anchor per type, stored only when the import commits). The companion also stores anchors locally. |
| Only new or changed samples | Anchored queries (companion). Overlapping short window (Shortcuts). |
| Unique ids, idempotency | `external_id` unique (HealthKit UUID or content hash). Replays of an identical `syncId` + body return the stored result. |
| Late samples | Anchored queries report samples by insertion, not by date, so late writes appear in the next sync. Shortcuts' overlapping window re-reads recent hours. Aggregates are computed on read. |
| Corrections and deletions | `deleted[]` from `HKDeletedObject`. Upsert-on-change by id. `replaceWindows` for id-less sources. |
| Configurable backfill | Companion setting "Initial backfill" (days). Applies to types without an anchor; "Re-send history" resets anchors. |
| Safe retries | Transactions, idempotent upserts, anchors advanced only after a 2xx response. |
| Queue unsent changes | Implicit queue: un-advanced anchors. Pending counts are reported to `POST /api/v1/health/status`. |
| Stale detection | `state = stale` after `VIGOR_STALE_AFTER_HOURS` (default 3 h) without success. Shown on the dashboard, sidebar pill and sync page. |
| Import statistics | Accepted, updated, skipped, rejected and deleted per run, on the sync page and in the API response. |
| Recalculating daily summaries | No stored summaries: all daily values are computed from raw samples on every read. |
| Absent ≠ zero | Aggregation emits no value for days without samples, and the UI renders "no data". |
| No wholesale replacement | Upserts are per sample. `replaceWindows` are limited to the declaring source, the declared type and ≤ 62 days. |

## Setting up the companion app

Requirements: an iPhone on iOS 17+, a Mac with Xcode 16+, an Apple ID, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
cd ios/VigorSync
xcodegen generate            # creates VigorSync.xcodeproj from project.yml
open VigorSync.xcodeproj
```

1. In Xcode, select the *VigorSync* target → *Signing & Capabilities* → choose your Team. Change the bundle identifier if Xcode reports it is taken. The HealthKit and Background Delivery entitlements are already configured.
2. Connect the iPhone and press Run. On the phone, trust the developer certificate if asked (Settings → General → VPN & Device Management).
3. In Vigor (browser), create an ingestion token (Apple Health sync page or Settings → Integrations).
4. In the app, enter the server URL, e.g. `http://192.168.1.20:3000`, and paste the token. The token is stored in the iOS Keychain. Tap **Test connection**. Allow *Local Network* access when iOS asks.
5. Tap **Grant Health access** and enable the types you want. You can change this later in Settings → Health → Data Access & Devices.
6. Set **Initial backfill** (default 30 days) and tap **Sync now**. Large histories are sent in batches of 5,000 changes per type.
7. Make sure Settings → General → Background App Refresh is enabled for Vigor Sync.

`NSAllowsLocalNetworking` permits plain `http://` to LAN addresses and `.local` names only. For anything else, use HTTPS.

**Source code map** (`ios/VigorSync/Sources`):

| File | Role |
| --- | --- |
| `HealthTypes.swift` | Vigor metric key ↔ HealthKit type and unit table. |
| `SyncEngine.swift` | Anchored queries, payload building, upload, anchor advancement, status reports. Also reads each workout's `HKWorkoutRoute`, thinned to roughly one point every 8s/15m, as `route` on the workout. |
| `BackgroundSync.swift` | Background delivery, observer queries, BGAppRefreshTask. |
| `APIClient.swift` | HTTP client (bearer header, JSON). |
| `SettingsStore.swift` | Server URL, backfill and anchors (UserDefaults); token (Keychain, `AfterFirstUnlockThisDeviceOnly`). |
| `ContentView.swift`, `VigorSyncApp.swift` | UI and app lifecycle. |

> **Status:** the companion uses only documented public APIs, but it has **not** been compiled in this repository's CI (no macOS runner). Expect possible minor compile fixes for your Xcode version.

## Workout routes

The companion also syncs each workout's GPS route (`HKWorkoutRoute`), shown on the workout detail page. Two decisions follow directly from this app's "no external network calls" rule (see `CLAUDE.md`):

- **No basemap.** A street or satellite map needs tile imagery fetched live from an outside service (Apple Maps, Google, Mapbox, even plain OpenStreetMap) — a network call this app deliberately never makes. The route is instead drawn as a plain-line SVG, to scale, with a start/finish marker and a distance scale bar (`src/components/RouteMap.tsx`) — the shape of where you went, not a map tile.
- **Place name, looked up offline.** Reverse geocoding normally means sending your coordinates to a geocoding API. Instead, Vigor bundles a static, build-time-generated list of the world's cities with population ≥ 15,000 (`src/lib/geo/cities.json`, ~24k entries, trimmed from GeoNames data) and finds the nearest one itself (`src/lib/geo/nearest-city.ts`) — no network call, ever. A point more than 80 km from any known city gets no label rather than a misleading guess.

Shortcuts has no action that reads workout routes, so this is companion-app only.

## Observing synchronisation

- **Dashboard header and sidebar pill:** last successful sync, with a stale or failing state.
- **Apple Health sync page:** last success and attempt, 24-hour counts, failures since success, phone-reported pending changes and errors, full import history with per-record rejection reasons, and stored cursors.
- **API:** `GET /api/v1/health/status`.

## Future work

- A server-side importer for `export.zip`, streaming the XML for initial history. It should feed `importHealthPayload` in batches with `source: "apple-export"`.
- Optional adapters for third-party exporters' JSON formats.
