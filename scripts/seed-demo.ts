/**
 * Loads clearly-labelled SYNTHETIC demonstration data into the configured database.
 * Every health sample uses source "demo"; remove it via Settings → Data → "Remove demo data"
 * or `npm run db:seed-demo -- --remove`.
 *
 * Nothing here is real personal data.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";
import { seedDemoData, removeDemoData } from "../src/lib/demo";

const db = openDatabase(config.dbPath);
if (process.argv.includes("--remove")) {
  console.log(removeDemoData(db));
} else {
  const csv = fs.readFileSync(path.join(__dirname, "../samples/hevy-workouts-synthetic.csv"), "utf8");
  console.log(seedDemoData(db, { days: 120, hevyCsv: csv }));
}
db.close();
