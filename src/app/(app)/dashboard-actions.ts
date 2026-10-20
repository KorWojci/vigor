"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeLayout } from "@/lib/dashboard-layout";
import { db, requireUser } from "@/lib/server/context";
import { setSetting } from "@/lib/settings";

/** Saves the dashboard layout chosen in the editor. Unknown widget keys are dropped. */
export async function saveDashboardLayoutAction(form: FormData) {
  await requireUser();
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(form.get("layout") ?? "{}"));
  } catch {
    redirect("/?edit=1&error=Could%20not%20read%20the%20layout");
  }
  setSetting(db(), "dashboardLayout", normalizeLayout(parsed));
  revalidatePath("/");
  const back = String(form.get("returnTo") ?? "/");
  redirect(`${back.startsWith("/settings") ? "/settings?tab=metrics&" : "/?"}ok=Dashboard%20layout%20saved`);
}
