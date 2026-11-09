"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { setLessonCompleted, setLessonConfusing, StudyError } from "../study";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const id = z.string().min(1).max(64);

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof StudyError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That lesson no longer exists." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function setLessonCompletedAction(courseId: string, lessonId: string, completed: boolean): Promise<Result<{ pct: number }>> {
  const user = await requireUser();
  try {
    const pct = await setLessonCompleted(user.id, id.parse(lessonId), completed === true);
    revalidatePath(`/courses/${id.parse(courseId)}`, "layout");
    return { ok: true, pct };
  } catch (err) {
    return fail(err);
  }
}

export async function setLessonConfusingAction(lessonId: string, confusing: boolean): Promise<Result> {
  const user = await requireUser();
  try {
    await setLessonConfusing(user.id, id.parse(lessonId), confusing === true);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
