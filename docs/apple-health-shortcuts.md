# Syncing Apple Health with Shortcuts

This is the no-build alternative to the companion app. Read the limitations first.

## Limitations (please read)

- **There is no hourly trigger.** *Time of Day* automations repeat daily, weekly or monthly. For hourly syncing, create **one automation per hour** you care about (e.g. 07:00–23:00 = 17 automations). Fewer automations mean coarser updates. A single daily automation is a daily sync, not an hourly one.
- **Health data is unavailable while the iPhone is locked.** Runs while it is locked may fail or send nothing. Because each run sends an overlapping window, the next successful run catches up.
- **No sample identifiers or deletions.** Shortcuts does not expose HealthKit UUIDs. Vigor deduplicates by content, so re-sending the same samples is harmless. Edited or deleted samples are reconciled only when the Shortcut declares the window as complete (`replaceWindows`, step 6).
- **Speed.** Looping over thousands of samples is slow in Shortcuts. Keep the window short (≈ 6 hours) and avoid very high-frequency types unless you need them.

## Before you start

1. Vigor runs on a computer or server on your home network. Find its LAN address: `ip addr` (Linux), `ipconfig` (Windows), System Settings → Wi-Fi → Details (macOS), or your router's client list. The import URL is `http://<address>:3000/api/v1/health/import`. Use the HTTPS URL if you run a reverse proxy. **Never `localhost`.**
2. In Vigor, open **Apple Health sync** and create an ingestion token. Copy it somewhere safe; it is shown only once.
3. On the iPhone, open Safari at `http://<address>:3000/api/healthz`. It should show `{"ok":true,…}`. If not, fix connectivity first (same Wi-Fi, firewall, port).

## Building the Shortcut

Create a new Shortcut named **Vigor Sync**.

### 1. Prepare variables

- **Date** (*Current Date*) → **Format Date**: Date Format *ISO 8601*, include time → *Set Variable* `Now`.
- **Text** `Bearer vgr_…your token…` → *Set Variable* `Auth`. (Shortcuts stores this in the shortcut. Don't share the Shortcut with the token inside.)

### 2. Find samples (repeat per type)

For each type you want, add **Find Health Samples**:

- *Type*: e.g. **Steps**
- Filter: **Start Date** *is in the last* **6 hours**
- Sort by *Start Date*; **no limit** (a limit combined with `replaceWindows` would delete valid data)

Grant Shortcuts read access to each type when asked (or in Settings → Health → Data Access & Devices → Shortcuts).

Suggested types and their Vigor keys:

| Health type | `type` value |
| --- | --- |
| Steps | `step_count` |
| Walking + Running Distance | `distance_walking_running` |
| Active Energy | `active_energy` |
| Resting Energy | `basal_energy` |
| Exercise Minutes | `exercise_time` |
| Resting Heart Rate | `resting_heart_rate` |
| Heart Rate Variability | `heart_rate_variability` |
| Weight | `body_mass` |
| Body Fat Percentage | `body_fat_percentage` |
| Sleep | `sleep_analysis` (value goes in `category`) |
| Dietary Energy / Protein / Carbohydrates / Fat / Water | `dietary_energy` / `dietary_protein` / `dietary_carbohydrates` / `dietary_fat` / `dietary_water` |

The full list is on the Apple Health sync page and in `docs/import-api.md`.

### 3. Turn samples into dictionaries

After each *Find Health Samples*, add **Repeat with Each** over its result. Inside the loop:

1. **Get Details of Health Sample**: *Value* → Set Variable `V`. Repeat for *Unit* (`U`), *Start Date* (`S`), *End Date* (`E`) and *Source* (`Src`).
2. **Format Date** `S` → ISO 8601 → `S2`; the same for `E` → `E2`.
3. **Dictionary**:
   - `type` (Text): `step_count` (the key for this block)
   - `value` (Number): `V`
   - `unit` (Text): `U`
   - `startAt` (Text): `S2`
   - `endAt` (Text): `E2`
   - `sourceName` (Text): `Src`
4. **Add to Variable** `Samples`.

For **sleep**, set `category` (Text) = `V` (e.g. *Core*, *Deep*, *REM*, *Awake*, *In Bed*, *Asleep*) and omit `value`/`unit`. Vigor maps these labels itself.

Units such as `count`, `kcal`, `km`, `mi`, `count/min`, `ms`, `kg`, `lb`, `%`, `g` and `mL` are converted automatically. A percentage shown as `0.18` with unit `%` is treated as a fraction.

### 4. Build the request

Add **Get Contents of URL**:

- URL: `http://<address>:3000/api/v1/health/import`
- Method: **POST**
- Headers:
  - `Authorization` → variable `Auth`
  - `Content-Type` → `application/json`
- Request Body: **JSON**
  - `schemaVersion` (Number) `1`
  - `source` (Text) `apple-shortcuts`
  - `syncId` (Text) `Now` (unique per run)
  - `generatedAt` (Text) `Now`
  - `samples` (Array) → variable `Samples`
  - optional `replaceWindows` (Array), see step 6

**Never put the token in the URL.**

### 5. Show the result while testing

Add **Get Dictionary Value** `summary` from *Contents of URL* → **Show Result**, or use *Quick Look* on the response. A successful run returns something like:

```json
{"ok":true,"status":"success","summary":{"received":42,"accepted":30,"updated":0,"skipped":12,"rejected":0,"deleted":0}}
```

`skipped` is normal: those samples were already sent by the previous, overlapping run.

### 6. Optional: reconcile edits and deletions

If a type is queried with **no limit**, the Shortcut can declare its window complete. Vigor then removes samples *from `apple-shortcuts`* in that window that are no longer in Health:

- Compute `WindowStart` = *Adjust Date* `Current Date` by −6 hours → Format ISO 8601.
- Add a Dictionary `{ "type": "step_count", "startAt": WindowStart, "endAt": Now }` to a variable `Windows`, once per type.
- Add `replaceWindows` (Array) → `Windows` to the JSON body.

Make sure the *Find* filter and the window match: "Start Date is in the last 6 hours" and the same 6 hours.

A complete example body is in [`samples/import-payload-example.json`](../samples/import-payload-example.json).

## Scheduling

1. Shortcuts → **Automation** → **+** → **Time of Day**.
2. Choose a time (e.g. 07:00), *Repeat: Daily*, then **Run Immediately** (iOS 17+; on older versions turn off *Ask Before Running*).
3. Action: **Run Shortcut** → *Vigor Sync*.
4. Repeat for every hour you want. iOS has no "every hour" option.

Useful supplementary triggers: **Charger → Is Connected** (often while unlocked), **App → Is Opened** (e.g. when you open Fitness). Extra runs are harmless thanks to deduplication.

Set **Settings → Integrations → Target interval** in Vigor to match your schedule (e.g. 60 or 120 minutes), and adjust `VIGOR_STALE_AFTER_HOURS` so the stale warning fits it (e.g. 3 for hourly, 12 for a few runs a day).

## Testing and troubleshooting

| Problem | Check |
| --- | --- |
| "Could not connect" | Phone on the same Wi-Fi; the URL uses the LAN IP and port; host firewall; `http://<ip>:3000/api/healthz` opens in Safari. |
| `401` | `Authorization` must be exactly `Bearer <token>` with one space; the token is not revoked. |
| `400` | Request Body must be *JSON*, not *Form*. |
| `422` | The response lists `issues`. Usually a missing `schemaVersion`/`syncId`, or dates not formatted as ISO 8601. |
| `partial` with rejections | See Vigor → Apple Health sync → Import history → issues (e.g. a misspelled `type`). |
| Runs at night send nothing | Expected: Health is locked. The morning run catches up if its window is long enough; consider a 10–12 h window for the first morning run. |
| Duplicated totals | Vigor keeps the larger source per hour for activity types. If you also run the companion app, prefer one integration. |
