# Hevy import

Apple Health workouts contain a summary (activity type, duration, energy, distance, heart rate) but **no exercises, sets, repetitions or weights**. Vigor gets that detail from Hevy's official CSV export. It never asks for your Hevy password and uses no private API.

## Exporting from Hevy

1. In the Hevy app: **Profile → Settings (gear) → Export & Import Data → Export Data → Export Workouts**. Menu names vary slightly between versions.
2. Save or share the resulting `.csv` (AirDrop, Files, email).
3. In Vigor: **Settings → Training imports → Import from Hevy**, choose the file and click **Import**.

The summary shows how many workouts were new, updated, unchanged or removed, and how many rows were rejected. Every import is listed in the import history.

## Format understood

Hevy exports one row per set:

```
"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
```

- Imperial exports (`weight_lbs`, `distance_miles`) are converted to kg and m.
- Accepted `start_time` formats: `20 Oct 2026, 07:05`, `Oct 20, 2026 7:05 PM`, `2026-10-20 07:05:00`, and ISO 8601 with an offset. Hevy writes **local time without a time zone**, so Vigor interprets it in the time zone from Settings → Application. Set it before importing.
- `set_type`: `normal`, `warmup`, `failure`, `dropset`. Warm-ups are shown but excluded from statistics.
- Required columns: `title`, `start_time`, `exercise_title`. Rows with an unparseable time or no exercise are rejected individually.

A synthetic example is in [`samples/hevy-workouts-synthetic.csv`](../samples/hevy-workouts-synthetic.csv).

## Duplicate handling

- A workout's identity is its **title + start time**. Re-importing an export, or a newer export containing older workouts, never creates duplicates:
  - identical content → *unchanged*;
  - changed sets, notes or end time → *updated* (the workout's exercises and sets are replaced).
- **Remove Hevy workouts that are not in this export:** optional. Workouts deleted in Hevy disappear from Vigor. Only use it with a *complete* export.
- Renaming a workout or changing its start time in Hevy makes it a new workout. Use the remove option above to clean up the old copy.
- Hevy can also write workouts to Apple Health. When an Apple Health workout overlaps a Hevy workout by more than half its duration, Vigor shows them as one workout: sets from Hevy, energy and heart rate from Apple Health.

## Exercise matching

- Exercises are matched by name, ignoring case and extra spaces.
- **Merge** (Settings → Training imports → Exercise matching) combines two exercises, e.g. after renaming one in Hevy. All history moves to the exercise you keep, and the other name becomes an *alias*, so future imports with the old name map correctly.
- **Exercise type** is inferred and can be overridden on the exercise page:

| Type | Inferred when | Progress measured by |
| --- | --- | --- |
| Weighted | weight and reps | estimated 1RM (Epley, 1–12 reps), heaviest set, volume |
| Weighted bodyweight | name contains "weighted" and has weight | as weighted (weight = added load) |
| Bodyweight | reps without weight | best set reps, total reps |
| Assisted | name contains "assisted" | least assistance (lower is better), total reps |
| Duration | time only | longest set, total time |
| Distance | distance | longest set, total distance |

## Limitations

- Bodyweight exercises don't include your body weight in volume.
- The e1RM is an estimate and is not computed for sets above 12 reps.
- Hevy's official API (an API key, for Hevy Pro users) is not integrated yet. It would allow automatic imports and is a natural next adapter (`src/lib/training/`).
