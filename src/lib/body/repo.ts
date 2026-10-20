import type { DB } from "../db";
import type { MeasurementDimension } from "./measurement-types";

export interface MeasurementType {
  key: string;
  label: string;
  dimension: MeasurementDimension;
  region: string | null;
  builtin: boolean;
}

export interface MeasurementEntry {
  id: number;
  typeKey: string;
  value: number;
  measuredAt: number;
  note: string | null;
}

/** Canonical storage unit per dimension. */
export const CANONICAL_UNIT: Record<MeasurementDimension, string> = { length: "cm", mass: "kg", percent: "%" };

export function listMeasurementTypes(db: DB): MeasurementType[] {
  return (
    db
      .prepare("SELECT key, label, dimension, region, builtin FROM measurement_types ORDER BY builtin DESC, sort_order, label")
      .all() as (Omit<MeasurementType, "builtin"> & { builtin: number })[]
  ).map((r) => ({ ...r, builtin: r.builtin === 1 }));
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function createCustomMeasurementType(db: DB, label: string, dimension: MeasurementDimension, region: string | null): MeasurementType {
  const clean = label.trim();
  if (!clean || clean.length > 60) throw new Error("Name must be 1–60 characters.");
  const key = "custom_" + (slugify(clean) || Date.now().toString(36));
  const exists = db.prepare("SELECT 1 FROM measurement_types WHERE key = ?").get(key);
  if (exists) throw new Error("A measurement with this name already exists.");
  db.prepare(
    "INSERT INTO measurement_types (key, label, dimension, region, builtin, sort_order, created_at) VALUES (?, ?, ?, ?, 0, 1000, ?)",
  ).run(key, clean, dimension, region, Date.now());
  return { key, label: clean, dimension, region, builtin: false };
}

/** Deletes a custom type and (via cascade) its entries. Built-in types cannot be deleted. */
export function deleteCustomMeasurementType(db: DB, key: string): void {
  db.prepare("DELETE FROM measurement_types WHERE key = ? AND builtin = 0").run(key);
}

export function addMeasurement(db: DB, typeKey: string, value: number, measuredAt: number, note: string | null): number {
  const type = db.prepare("SELECT dimension FROM measurement_types WHERE key = ?").get(typeKey) as { dimension: MeasurementDimension } | undefined;
  if (!type) throw new Error("Unknown measurement type.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Value must be a positive number.");
  if (type.dimension === "percent" && value > 100) throw new Error("Percentages cannot exceed 100.");
  if (!Number.isFinite(measuredAt) || measuredAt > Date.now() + 24 * 3600_000) throw new Error("Invalid measurement date.");
  const now = Date.now();
  const info = db
    .prepare("INSERT INTO body_measurements (type_key, value, measured_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(typeKey, value, measuredAt, note?.trim() || null, now, now);
  return Number(info.lastInsertRowid);
}

export function deleteMeasurement(db: DB, id: number): void {
  db.prepare("DELETE FROM body_measurements WHERE id = ?").run(id);
}

export function listMeasurements(db: DB, typeKey?: string, limit = 500): MeasurementEntry[] {
  const sql = `SELECT id, type_key AS typeKey, value, measured_at AS measuredAt, note FROM body_measurements
    ${typeKey ? "WHERE type_key = ?" : ""} ORDER BY measured_at DESC, id DESC LIMIT ?`;
  const args = typeKey ? [typeKey, limit] : [limit];
  return db.prepare(sql).all(...args) as MeasurementEntry[];
}

export interface MeasurementLatest {
  typeKey: string;
  latest: MeasurementEntry;
  previous: MeasurementEntry | null;
  first: MeasurementEntry;
  count: number;
}

/** Latest, previous and first entry for every measurement type that has data. */
export function latestMeasurements(db: DB): Map<string, MeasurementLatest> {
  const all = db
    .prepare("SELECT id, type_key AS typeKey, value, measured_at AS measuredAt, note FROM body_measurements ORDER BY measured_at DESC, id DESC")
    .all() as MeasurementEntry[];
  const map = new Map<string, MeasurementLatest>();
  for (const e of all) {
    const cur = map.get(e.typeKey);
    if (!cur) map.set(e.typeKey, { typeKey: e.typeKey, latest: e, previous: null, first: e, count: 1 });
    else {
      if (!cur.previous) cur.previous = e;
      cur.first = e;
      cur.count++;
    }
  }
  return map;
}
