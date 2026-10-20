"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EXERCISE_KINDS, type ExerciseKind } from "@/lib/training/calculations";
import { setExerciseKind } from "@/lib/training/repo";
import { db, requireUser } from "@/lib/server/context";

export async function setKindAction(form: FormData) {
  await requireUser();
  const id = Number(form.get("exerciseId"));
  const kind = String(form.get("kind"));
  if (!Number.isInteger(id) || !(kind === "auto" || EXERCISE_KINDS.some((k) => k.key === kind))) redirect(`/training/exercises/${id}?error=Invalid%20kind`);
  setExerciseKind(db(), id, kind as ExerciseKind | "auto");
  revalidatePath(`/training/exercises/${id}`);
  redirect(`/training/exercises/${id}?ok=Exercise%20type%20updated`);
}
