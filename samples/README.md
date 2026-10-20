# Synthetic sample data

Everything in this directory is **invented** for tests, demos and documentation. None of it is anyone's real health data.

| File | Purpose |
| --- | --- |
| `hevy-workouts-synthetic.csv` | A tiny Hevy workout export (3 workouts) in Hevy's CSV format. Used by tests and the demo seeder. |
| `import-payload-example.json` | An example body for `POST /api/v1/health/import`, shaped like a Shortcuts sync. |

Load a larger synthetic history (120 days, labelled source `demo`) with `npm run db:seed-demo` or from **Settings → Data → Load demo data**; remove it with `npm run db:seed-demo -- --remove` or the same button.
