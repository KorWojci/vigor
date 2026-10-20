/** Applies pending database migrations (also happens automatically on server start). */
import { config } from "../src/lib/config";
import { currentSchemaVersion, openDatabase } from "../src/lib/db";

const db = openDatabase(config.dbPath);
console.log(`Database ${config.dbPath} is at schema version ${currentSchemaVersion(db)}.`);
db.close();
