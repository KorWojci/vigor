"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteSampleById } from "@/lib/ingest/health-import";
import { db, requireUser } from "@/lib/server/context";

export async function deleteSampleAction(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  const type = String(form.get("type") ?? "");
  const range = String(form.get("range") ?? "");
  const back = `/metrics/${type}${range ? `?range=${range}` : ""}`;
  const deleted = Number.isInteger(id) && deleteSampleById(db(), id);
  revalidatePath(`/metrics/${type}`);
  revalidatePath("/");
  redirect(deleted ? `${back}${range ? "&" : "?"}ok=Sample deleted.` : `${back}${range ? "&" : "?"}error=Sample was already gone.`);
}
