import type { DB } from "./index";
import { BUILTIN_MEASUREMENT_TYPES } from "../body/measurement-types";

/** Inserts built-in reference rows. Idempotent; never touches user data. */
export function seedBuiltins(db: DB): void {
  const insert = db.prepare(
    `INSERT INTO measurement_types (key, label, dimension, region, builtin, sort_order, created_at)
     VALUES (@key, @label, @dimension, @region, 1, @sortOrder, @createdAt)
     ON CONFLICT(key) DO UPDATE SET label = excluded.label, dimension = excluded.dimension,
       region = excluded.region, sort_order = excluded.sort_order
     WHERE measurement_types.builtin = 1`,
  );
  const now = Date.now();
  db.transaction(() => {
    BUILTIN_MEASUREMENT_TYPES.forEach((t, i) =>
      insert.run({ key: t.key, label: t.label, dimension: t.dimension, region: t.region ?? null, sortOrder: i, createdAt: now }),
    );
  })();
}
