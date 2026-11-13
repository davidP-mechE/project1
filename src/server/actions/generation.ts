"use server";

import { revalidatePath } from "next/cache";
import { LimitError } from "../limits";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { GenerationError, regenerateAll, regenerateLesson, saveLessonEdits, startGeneration } from "../generation/lessons";
import type { LessonEdit } from "@/lib/ai/lesson-schema";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const id = z.string().min(1).max(64);

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof GenerationError || err instanceof LimitError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That course or lesson no longer exists." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function startGenerationAction(courseId: string): Promise<Result<{ queued: number }>> {
  const user = await requireUser();
  try {
    const res = await startGeneration(user.id, id.parse(courseId));
    revalidatePath(`/courses/${courseId}`);
    return { ok: true, queued: res.queued };
  } catch (err) {
    return fail(err);
  }
}

export async function regenerateAllAction(courseId: string, includeEdited: boolean): Promise<Result<{ queued: number }>> {
  const user = await requireUser();
  try {
    const res = await regenerateAll(user.id, id.parse(courseId), { includeEdited: Boolean(includeEdited) });
    revalidatePath(`/courses/${courseId}`);
    return { ok: true, queued: res.queued };
  } catch (err) {
    return fail(err);
  }
}

export async function regenerateLessonAction(
  courseId: string,
  lessonId: string,
  mode: "lesson" | "questions",
  allowThin = false,
): Promise<Result> {
  const user = await requireUser();
  try {
    await regenerateLesson(user.id, id.parse(lessonId), { mode: mode === "questions" ? "questions" : "lesson", allowThin: Boolean(allowThin) });
    revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveLessonEditsAction(courseId: string, lessonId: string, edit: LessonEdit): Promise<Result> {
  const user = await requireUser();
  try {
    await saveLessonEdits(user.id, id.parse(lessonId), edit);
    revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
