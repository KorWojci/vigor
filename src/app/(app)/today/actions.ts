"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeTodayLayout } from "@/lib/today-layout";
import { db, requireUser } from "@/lib/server/context";
import { setSetting } from "@/lib/settings";

/** Saves the Today-page layout chosen in the editor. Unknown/cross-section metric keys are dropped. */
export async function saveTodayLayoutAction(form: FormData) {
  await requireUser();
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(form.get("layout") ?? "{}"));
  } catch {
    redirect("/today?edit=1&error=Could%20not%20read%20the%20layout");
  }
  setSetting(db(), "todayLayout", normalizeTodayLayout(parsed));
  revalidatePath("/today");
  redirect("/today?ok=Today%20layout%20saved");
}
