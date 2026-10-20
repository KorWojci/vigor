"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addMeasurement, createCustomMeasurementType, deleteCustomMeasurementType, deleteMeasurement, CANONICAL_UNIT } from "@/lib/body/repo";
import type { MeasurementDimension } from "@/lib/body/measurement-types";
import { db, requireUser } from "@/lib/server/context";
import { getSettings } from "@/lib/settings";
import { zonedWallTimeToUtc } from "@/lib/time";
import { fromDisplay } from "@/lib/units";

const back = (q: Record<string, string>) => `/body?${new URLSearchParams(q)}`;

export async function addMeasurementAction(form: FormData) {
  await requireUser();
  const database = db();
  const settings = getSettings(database);
  const typeKey = String(form.get("type") ?? "");
  const raw = Number(String(form.get("value") ?? "").replace(",", "."));
  const when = String(form.get("measuredAt") ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when);
  const type = database.prepare("SELECT dimension FROM measurement_types WHERE key = ?").get(typeKey) as { dimension: MeasurementDimension } | undefined;
  if (!type) redirect(back({ error: "Choose a measurement type." }));
  if (!m) redirect(back({ type: typeKey, error: "Enter a valid date and time." }));
  const measuredAt = zonedWallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], 0, settings.timezone);
  try {
    addMeasurement(database, typeKey, fromDisplay(raw, CANONICAL_UNIT[type.dimension], settings.units), measuredAt, String(form.get("note") ?? ""));
  } catch (e) {
    redirect(back({ type: typeKey, error: e instanceof Error ? e.message : "Could not save." }));
  }
  revalidatePath("/body");
  revalidatePath("/");
  redirect(back({ type: typeKey, ok: "Measurement saved." }));
}

export async function deleteMeasurementAction(form: FormData) {
  await requireUser();
  deleteMeasurement(db(), Number(form.get("id")));
  revalidatePath("/body");
  redirect(back({ type: String(form.get("type") ?? ""), ok: "Measurement deleted." }));
}

export async function createTypeAction(form: FormData) {
  await requireUser();
  const dimension = String(form.get("dimension"));
  if (!["length", "mass", "percent"].includes(dimension)) redirect(back({ error: "Choose what the measurement is." }));
  let created: { key: string; label: string };
  try {
    created = createCustomMeasurementType(db(), String(form.get("label") ?? ""), dimension as MeasurementDimension, null);
  } catch (e) {
    redirect(back({ error: e instanceof Error ? e.message : "Could not add the measurement type." }));
  }
  revalidatePath("/body");
  redirect(back({ type: created.key, ok: `Added “${created.label}”.` }));
}

export async function deleteTypeAction(form: FormData) {
  await requireUser();
  deleteCustomMeasurementType(db(), String(form.get("key")));
  revalidatePath("/body");
  redirect(back({ ok: "Custom measurement and its history deleted." }));
}
