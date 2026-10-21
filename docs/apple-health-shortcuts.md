# Syncing Apple Health with Shortcuts

This is the no-build alternative to the companion app. Read the limitations first.

## Limitations (please read)

- **There is no hourly trigger.** *Time of Day* automations repeat daily, weekly or monthly. For hourly syncing, create **one automation per hour** you care about (e.g. 07:00–23:00 = 17 automations). Fewer automations mean coarser updates. A single daily automation is a daily sync, not an hourly one.
- **Health data is unavailable while the iPhone is locked.** Runs while it is locked may fail or send nothing. Because each run sends an overlapping window, the next successful run catches up.
- **No sample identifiers or deletions.** Shortcuts does not expose HealthKit UUIDs. Vigor deduplicates by content, so re-sending the same samples is harmless. Edited or deleted samples are reconciled through the replace windows the Shortcut declares for every type that returned samples (step 3).
- **Speed.** Looping over thousands of samples is slow in Shortcuts. Keep the window short (≈ 6 hours) and leave out very high-frequency types (`heart_rate`) unless you need them.

## Before you start

1. Vigor runs on a computer or server on your home network. Find its LAN address: `ip addr` (Linux), `ipconfig` (Windows), System Settings → Wi-Fi → Details (macOS), or your router's client list. The import URL is `http://<address>:3000/api/v1/health/import`. Use the HTTPS URL if you run a reverse proxy. **Never `localhost`.**
2. In Vigor, open **Apple Health sync** and create an ingestion token. Copy it somewhere safe; it is shown only once.
3. On the iPhone, open Safari at `http://<address>:3000/api/healthz`. It should show `{"ok":true,…}`. If not, fix connectivity first (same Wi-Fi, firewall, port).

## Building the Shortcut

Create a new Shortcut named **Vigor Sync**. It is **one loop over a list of types**. Adding or removing a metric means editing one dictionary entry, not copying a block of actions.

```
Vigor Sync
├─ Now, WindowStart, Auth                        (step 1)
├─ Dictionary  Types  { vigor key → Health type } (step 2)
├─ Repeat with Each  key in Types                 (step 3)
│   ├─ Find Health Samples  Type = Types[key], last 6 hours, no limit
│   ├─ Repeat with Each  sample
│   │   └─ Dictionary { type, value, category, unit, startAt, endAt, sourceName } → Samples
│   └─ If found anything → { type, startAt: WindowStart, endAt: Now } → Windows
├─ Dictionary Body { …, samples, replaceWindows } → Text → Get Contents of URL (File body) (step 4)
└─ Show Result                                    (step 5)
```

### 1. Prepare variables

- **Current Date** → **Format Date**: Date Format *ISO 8601*, *Include ISO 8601 Time* on → *Set Variable* `Now`.
- **Current Date** → **Adjust Date**: *Subtract* **6** *hours* → **Format Date** (ISO 8601, with time) → *Set Variable* `WindowStart`.
- **Text** `Bearer vgr_…your token…` → *Set Variable* `Auth`. (The token is stored inside the Shortcut. Don't share the Shortcut with the token inside.)

### 2. List the types once

Add a **Dictionary** action and *Set Variable* `Types`. Each entry has a **key** (the Vigor key) and a **Text value** (the Health type's name **exactly as the *Type* picker of *Find Health Samples* shows it on your iPhone**). The picker uses your phone's language, so check the names there. English names:

| Vigor key (dictionary key) | Health type (dictionary value, English) |
| --- | --- |
| `step_count` | Steps |
| `distance_walking_running` | Walking + Running Distance |
| `active_energy` | Active Energy |
| `basal_energy` | Resting Energy |
| `exercise_time` | Exercise Minutes |
| `flights_climbed` | Flights Climbed |
| `heart_rate` | Heart Rate |
| `resting_heart_rate` | Resting Heart Rate |
| `walking_heart_rate` | Walking Heart Rate Average |
| `heart_rate_variability` | Heart Rate Variability |
| `oxygen_saturation` | Blood Oxygen |
| `respiratory_rate` | Respiratory Rate |
| `vo2_max` | VO2 Max (Cardio Fitness) |
| `sleep_analysis` | Sleep |
| `body_mass` | Weight |
| `height` | Height |
| `body_fat_percentage` | Body Fat Percentage |
| `lean_body_mass` | Lean Body Mass |
| `body_mass_index` | Body Mass Index |
| `waist_circumference` | Waist Circumference |
| `dietary_energy` | Dietary Energy |
| `dietary_protein` | Protein |
| `dietary_carbohydrates` | Carbohydrates |
| `dietary_fat` | Total Fat |
| `dietary_fiber` | Fiber |
| `dietary_sugar` | Sugar |
| `dietary_sodium` | Sodium |
| `dietary_caffeine` | Caffeine |
| `dietary_water` | Water |
| `body_temperature` | Body Temperature |
| `blood_pressure_systolic` | Blood Pressure Systolic |
| `blood_pressure_diastolic` | Blood Pressure Diastolic |
| `blood_glucose` | Blood Glucose |

Leave out types you don't record. They cost one empty query per run. `heart_rate` is the slowest by far (a Watch records hundreds of samples in 6 hours), so add it last and only if you want intraday heart rate. Stand hours (`stand_hours`) aren't supported through Shortcuts because their value is *Stood*/*Idle*. The companion app sends them.

The first run asks for Health read access for each type. You can also grant it in Settings → Health → Data Access & Devices → Shortcuts.

### 3. Loop over the types

1. **Repeat with Each** item in `Types`. Repeating over a dictionary gives its keys.
   1. *Set Variable* `Key` = *Repeat Item*. The inner loop below has its own *Repeat Item*, so keep the key in a named variable.
   2. **Get Dictionary Value**: *Value* for key `Key` in `Types` → *Set Variable* `HealthType`.
   3. **Find Health Samples**: tap *Type* and choose the variable `HealthType`. Filter **Start Date** *is in the last* **6 hours**. Sort by *Start Date*, **no limit**. → *Set Variable* `Found`.
   4. **Repeat with Each** item in `Found`:
      1. **Get Details of Health Sample** *Value* → `V`. Do the same for *Unit* → `U`, *Start Date* → `S`, *End Date* → `E` and *Source* → `Src`.
      2. **Format Date** `S` → ISO 8601 with time → `S2`. The same for `E` → `E2`.
      3. **Dictionary**. Every field below applies to every type, including sleep:
         - `type` (Text): `Key`
         - `value` (Number): `V`
         - `category` (Text): `V`
         - `unit` (Text): `U`
         - `startAt` (Text): `S2`
         - `endAt` (Text): `E2`
         - `sourceName` (Text): `Src`
      4. **Add to Variable** `Samples`.
   5. **Count** items in `Found`, then **If** *Count* *is greater than* `0`:
      - **Dictionary** `{ "type": Key, "startAt": WindowStart, "endAt": Now }` → **Add to Variable** `Windows`.

Why `V` goes into both `value` and `category`: a sleep sample's *Value* is its stage label (*Core*, *Deep*, *REM*, *Awake*, *In Bed*), and for every other type it is a number. Vigor reads `category` only for sleep and `value` only for other types, so the same row works for all of them. If your iPhone fails converting a sleep label into the *Number* field, change `value` to *Text*. Vigor also accepts numbers sent as text (`80.4`, `80,4`). It rejects only ambiguous text such as `1,234`, and the import history names each one.

The **If** guard matters. While the phone is locked, Health returns nothing. Without the guard, the Shortcut would declare the last 6 hours "complete and empty", and Vigor would delete the samples it already has for that window. Because of the guard, a type with zero samples is simply skipped. The trade-off: if you delete the *only* sample of a type in the window, that deletion is not reconciled.

Units such as `count`, `kcal`, `km`, `mi`, `count/min`, `ms`, `kg`, `lb`, `%`, `g` and `mL` are converted automatically. A percentage shown as `0.18` with unit `%` is treated as a fraction.

### 4. Build the request

After the outer loop, build the whole request body as **one Dictionary**, turn it into text, and send that text as the raw body:

1. **Dictionary** → *Set Variable* `Body`:
   - `schemaVersion` (Number) `1`
   - `source` (Text) `apple-shortcuts`
   - `syncId` (Text) `Now` (unique per run)
   - `generatedAt` (Text) `Now`
   - `samples` (List) → variable `Samples`
   - `replaceWindows` (List) → variable `Windows`
2. **Text** whose content is *only* the `Body` variable (nothing else in the field) → *Set Variable* `BodyJSON`. Shortcuts serializes a Dictionary to its JSON text when it is placed in a Text field.
3. Optional while testing: **Quick Look** `BodyJSON`. This is exactly what will be sent.
4. **Get Contents of URL**:
   - URL: `http://<address>:3000/api/v1/health/import`
   - Method: **POST**
   - Headers: `Authorization` → variable `Auth`; `Content-Type` → `application/json`
   - Request Body: **File** → variable `BodyJSON`

**Don't send `Body` through the *JSON* request body type.** That editor is a list of named fields: putting the `Body` dictionary into one field sends `{"Body": {…}}` (or `{"": {…}}` with an empty key), so Vigor finds no `schemaVersion`, `source`, `syncId` or `generatedAt` at the top level and answers `422` with `source: Required`, `syncId: Required`, `generatedAt: Required`. If you prefer the *JSON* editor, give each of the six keys its **own** field instead of one combined dictionary.

In the Dictionary action, the type for `samples` and `replaceWindows` is called **List**. Choose it, then select the variable as the value; don't add items with the inline “+”, which only builds a short literal list.

**Never put the token in the URL.** All types go in this one request. A 6-hour window is far below the 10 MiB limit.

### 5. Show the result while testing

Add **Get Dictionary Value** `summary` from *Contents of URL* → **Show Result**, or use *Quick Look* on the response. A successful run returns something like:

```json
{"ok":true,"status":"success","summary":{"received":42,"accepted":30,"updated":0,"skipped":12,"rejected":0,"deleted":0}}
```

`skipped` is normal: those samples were already sent by the previous, overlapping run.

### Alternative: sync "today" instead of a rolling 6-hour window

If you'd rather run this once or a few times a day than build 17 hourly automations, query the whole day instead of a short rolling window. It needs *less* building than the recipe above, not more — you drop `WindowStart` and `Windows` entirely:

- **Step 1:** skip the `WindowStart` *Adjust Date* action. You still need `Now` and `Auth`.
- **Step 3.3:** change the *Find Health Samples* filter from *Start Date is in the last 6 hours* to **Start Date is today**.
- **Step 3.5:** skip it — no `Windows` variable, no per-type dictionary, no *If* guard.
- **Step 4:** in the `Body` dictionary, drop `replaceWindows` and add instead:
  - `replaceToday` (Boolean) `true`

Every run re-sends and re-declares the *entire* day so far for every type that found anything, so there's no reliance on overlapping runs to catch up — run it once in the evening, or a few times through the day, and each run is self-contained. Vigor builds the replace window itself from `generatedAt`'s own time zone (the phone's zone when it built the request), spanning local midnight to that moment — see `replaceToday` in `docs/import-api.md`. The *If found anything* guard from step 3.5 isn't needed by hand here: Vigor only replaces today for a type when the batch contains a sample of that type from today, for the identical reason you'd build the guard for yourself. So a backfill run that also sets `replaceToday` (or a batch mixing older days with today) never deletes today's data for types it has no today samples for.

The only cost: payload size grows through the day as more samples accumulate (still trivial for anything but `heart_rate`, which can reach hundreds of samples by evening — still far under the 50,000-sample / 10 MiB limits, just slower for Shortcuts to build).

### If *Type* won't accept a variable

The type is taken from a variable in step 3.3. If your iOS version won't let you pick a variable for *Type*, keep the single loop body and change only the query. Use one *Find Health Samples* per type, each followed by **Add to Variable** `Found` (all of them into the same variable). Then loop over `Found` once and, in the loop, take **Get Details of Health Sample → Type**. Look that name up in a reversed dictionary (Health name → Vigor key) to fill `type`. The replace window then can't be per type, so leave `replaceWindows` out: exact re-sends are still deduplicated.

### Backfilling history

For a one-off import of older data, duplicate the Shortcut and change **both** 6-hour values (the *Find* filter and *Adjust Date*) to e.g. 7 days. The two must match. Run it while the phone is unlocked and on Wi-Fi. Shortcuts is slow with thousands of samples, so backfill a week at a time, or leave out `heart_rate`. Replace windows can cover at most 62 days.

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
| `400` | The body isn't JSON. Request Body must be *File* with the `BodyJSON` text (or *JSON*), not *Form*. |
| `422` | The response lists `issues`. `source`/`syncId`/`generatedAt: Required` together means the body is wrapped in an extra key (see step 4). Otherwise usually dates not formatted as ISO 8601. |
| `partial` with rejections | See Vigor → Apple Health sync → Import history → issues (e.g. a misspelled `type`). |
| Runs at night send nothing | Expected: Health is locked. The morning run catches up if its window is long enough; consider a 10–12 h window for the first morning run. |
| Duplicated totals | Vigor keeps the larger source per hour for activity types. If you also run the companion app, prefer one integration. |
