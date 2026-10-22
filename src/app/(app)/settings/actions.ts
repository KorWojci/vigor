"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiToken, revokeApiToken, rotateApiToken } from "@/lib/auth/api-tokens";
import { changePassword } from "@/lib/auth/users";
import { createBackup, deleteBackup, deleteData, restoreFromBuffer, type DeleteScope } from "@/lib/data/manage";
import { removeDemoData, seedDemoData } from "@/lib/demo";
import { db, requireUser } from "@/lib/server/context";
import { log } from "@/lib/server/log";
import { getSetting, setSetting, type Settings } from "@/lib/settings";
import { HevyFormatError, importHevyCsv } from "@/lib/training/hevy-import";
import { mergeExercises } from "@/lib/training/repo";

const go = (tab: string, msg: { ok?: string; error?: string }) => redirect(`/settings?${new URLSearchParams({ tab, ...msg })}`);

function done(tab: string, ok: string): never {
  revalidatePath("/", "layout");
  go(tab, { ok });
  throw new Error("unreachable");
}

/* ---------- tokens (results returned to the client so the token never appears in a URL) ---------- */

export interface TokenState {
  token?: string;
  name?: string;
  error?: string;
}

export async function createTokenAction(_prev: TokenState | undefined, form: FormData): Promise<TokenState> {
  await requireUser();
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "iPhone";
  const { token } = createApiToken(db(), name);
  log("info", "api_token_created", { name });
  revalidatePath("/settings");
  revalidatePath("/integrations/apple-health");
  return { token, name };
}

export async function rotateTokenAction(_prev: TokenState | undefined, form: FormData): Promise<TokenState> {
  await requireUser();
  const res = rotateApiToken(db(), Number(form.get("id")));
  if (!res) return { error: "Token not found." };
  revalidatePath("/settings");
  return { token: res.token, name: res.info.name };
}

export async function revokeTokenAction(form: FormData) {
  await requireUser();
  revokeApiToken(db(), Number(form.get("id")));
  done("integrations", "Token revoked. Devices using it can no longer send data.");
}

/* ---------- preferences ---------- */

export async function saveProfileAction(form: FormData) {
  await requireUser();
  const database = db();
  const birthYear = Number(form.get("birthYear"));
  const sex = String(form.get("sex") ?? "unspecified");
  const maxHeartRate = Number(form.get("maxHeartRate"));
  try {
    setSetting(database, "profile", {
      displayName: String(form.get("displayName") ?? "").trim() || undefined,
      birthYear: Number.isInteger(birthYear) && birthYear > 1900 ? birthYear : undefined,
      sex: (["female", "male", "other", "unspecified"].includes(sex) ? sex : "unspecified") as Settings["profile"]["sex"],
      maxHeartRate: Number.isInteger(maxHeartRate) && maxHeartRate >= 100 && maxHeartRate <= 240 ? maxHeartRate : undefined,
    });
    setSetting(database, "units", form.get("units") === "imperial" ? "imperial" : "metric");
  } catch {
    go("profile", { error: "Invalid profile values." });
  }
  done("profile", "Profile saved.");
}

export async function saveAppSettingsAction(form: FormData) {
  await requireUser();
  const database = db();
  try {
    setSetting(database, "timezone", String(form.get("timezone") ?? "UTC"));
    setSetting(database, "theme", String(form.get("theme")) as Settings["theme"]);
    setSetting(database, "defaultRange", String(form.get("defaultRange")) as Settings["defaultRange"]);
  } catch {
    go("app", { error: "Unknown time zone or invalid value. Use an IANA name such as Europe/Warsaw." });
  }
  done("app", "Application settings saved.");
}

export async function saveMetricsSettingsAction(form: FormData) {
  await requireUser();
  const database = db();
  const ma = Number(form.get("movingAverageDays"));
  setSetting(database, "movingAverageDays", ([0, 7, 14, 30].includes(ma) ? ma : 7) as Settings["movingAverageDays"]);
  done("metrics", "Chart settings saved.");
}

export async function saveSyncSettingsAction(form: FormData) {
  await requireUser();
  const minutes = Number(form.get("syncIntervalMinutes"));
  try {
    setSetting(db(), "syncIntervalMinutes", minutes);
  } catch {
    go("integrations", { error: "Interval must be between 15 and 1440 minutes." });
  }
  done("integrations", "Sync interval saved. Configure the same interval on the iPhone.");
}

export async function changePasswordAction(form: FormData) {
  const user = await requireUser();
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) go("profile", { error: "New passwords do not match." });
  try {
    changePassword(db(), user.id, String(form.get("current") ?? ""), next);
  } catch (e) {
    go("profile", { error: e instanceof Error ? e.message : "Could not change password." });
  }
  redirect("/login");
}

/* ---------- training imports ---------- */

export async function importHevyAction(form: FormData) {
  await requireUser();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go("training", { error: "Choose the CSV file exported from Hevy." });
  const f = file as File;
  if (f.size > 20 * 1024 * 1024) go("training", { error: "File is larger than 20 MB." });
  const database = db();
  let msg: string;
  try {
    const r = importHevyCsv(database, await f.text(), { tz: getSetting(database, "timezone"), fileName: f.name.slice(0, 120), removeMissing: form.get("removeMissing") === "on" });
    msg = `Imported ${r.workouts} workouts: ${r.accepted} new, ${r.updated} updated, ${r.skipped} unchanged${r.deleted ? `, ${r.deleted} removed` : ""}${r.rejected ? `, ${r.rejected} rows rejected` : ""}. ${r.exercisesCreated} new exercises.${r.removeSkipped ? " Nothing was removed: some rows could not be read, so the export can't be treated as complete." : ""}`;
  } catch (e) {
    go("training", { error: e instanceof HevyFormatError ? e.message : `Import failed: ${e instanceof Error ? e.message : "unknown error"}` });
    return;
  }
  revalidatePath("/training");
  done("training", msg);
}

export async function mergeExercisesAction(form: FormData) {
  await requireUser();
  try {
    mergeExercises(db(), Number(form.get("source")), Number(form.get("target")));
  } catch (e) {
    go("training", { error: e instanceof Error ? e.message : "Merge failed." });
  }
  done("training", "Exercises merged. Future imports of the old name map to the kept exercise.");
}

/* ---------- data management ---------- */

export async function createBackupAction() {
  await requireUser();
  const b = createBackup(db());
  done("data", `Backup ${b.name} created.`);
}

export async function deleteBackupAction(form: FormData) {
  await requireUser();
  deleteBackup(String(form.get("name")));
  done("data", "Backup deleted.");
}

export async function restoreBackupAction(form: FormData) {
  await requireUser();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go("data", { error: "Choose a Vigor backup (.db) file." });
  if (form.get("confirm") !== "RESTORE") go("data", { error: "Type RESTORE to confirm." });
  try {
    const r = restoreFromBuffer(Buffer.from(await (file as File).arrayBuffer()));
    log("warn", "database_restored", { schemaVersion: r.schemaVersion });
  } catch (e) {
    go("data", { error: e instanceof Error ? e.message : "Restore failed." });
  }
  // The restored database has its own accounts and sessions.
  redirect("/login");
}

export async function deleteDataAction(form: FormData) {
  await requireUser();
  const scope = String(form.get("scope")) as DeleteScope;
  if (!["health", "workouts", "measurements", "imports", "everything"].includes(scope)) go("data", { error: "Unknown scope." });
  if (form.get("confirm") !== "DELETE") go("data", { error: "Type DELETE to confirm permanent deletion." });
  const source = String(form.get("source") ?? "").trim() || undefined;
  const counts = deleteData(db(), scope, source);
  log("warn", "data_deleted", { scope, source: source ?? null, ...counts });
  done("data", `Deleted: ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.`);
}

export async function demoDataAction(form: FormData) {
  await requireUser();
  const database = db();
  if (form.get("op") === "remove") {
    const r = removeDemoData(database);
    done("data", `Demo data removed (${r.samples} samples, ${r.workouts} workouts, ${r.measurements} measurements).`);
  }
  const fs = await import("node:fs");
  const path = await import("node:path");
  let csv: string | undefined;
  try {
    csv = fs.readFileSync(path.join(process.cwd(), "samples/hevy-workouts-synthetic.csv"), "utf8");
  } catch {
    csv = undefined;
  }
  const r = seedDemoData(database, { days: 120, hevyCsv: csv });
  done("data", `Loaded synthetic demo data: ${r.samples} samples, ${r.workouts} workouts, ${r.measurements} measurements.`);
}
