"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { OutlineInvalidError, OutlineLockedError, saveOutline, saveSettings } from "../outline";
import type { EditableOutline, OutlineIssue } from "@/lib/outline/edit";
import type { CourseSettings } from "@/lib/course/settings";

export type SaveOutlineResult =
  | { ok: true; outline: EditableOutline }
  | { ok: false; error: string; issues?: OutlineIssue[] };

const courseId = z.string().min(1).max(64);

function failure(err: unknown): { ok: false; error: string; issues?: OutlineIssue[] } {
  if (err instanceof OutlineInvalidError) return { ok: false, error: err.message, issues: err.issues };
  if (err instanceof OutlineLockedError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That course no longer exists." };
  console.error(err);
  return { ok: false, error: "Couldn't save. Please try again." };
}

export async function saveOutlineAction(id: string, outline: EditableOutline): Promise<SaveOutlineResult> {
  const user = await requireUser();
  try {
    const saved = await saveOutline(user.id, courseId.parse(id), outline);
    revalidatePath(`/courses/${id}`);
    return { ok: true, outline: saved.outline };
  } catch (err) {
    return failure(err);
  }
}

export async function saveSettingsAction(
  id: string,
  settings: CourseSettings,
): Promise<{ ok: true; settings: CourseSettings } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const saved = await saveSettings(user.id, courseId.parse(id), settings);
    revalidatePath(`/courses/${id}`);
    return { ok: true, settings: saved };
  } catch (err) {
    return failure(err);
  }
}
