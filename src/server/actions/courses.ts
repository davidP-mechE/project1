"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { deleteCourse, NotFoundError, renameCourse, setCourseArchived } from "../courses";

/**
 * Server Actions: functions the browser calls directly from forms/buttons.
 * Each one re-checks who is logged in; never trust ids sent by the browser
 * without filtering by the current user (done inside the data layer).
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const idSchema = z.string().min(1).max(64);

async function run(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/library");
    return { ok: true };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "That course no longer exists." };
    if (err instanceof Error && err.message === "Title can't be empty.") return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function renameCourseAction(courseId: string, title: string): Promise<ActionResult> {
  const user = await requireUser();
  const id = idSchema.parse(courseId);
  return run(() => renameCourse(user.id, id, String(title)));
}

export async function archiveCourseAction(courseId: string, archived: boolean): Promise<ActionResult> {
  const user = await requireUser();
  const id = idSchema.parse(courseId);
  return run(() => setCourseArchived(user.id, id, Boolean(archived)));
}

export async function deleteCourseAction(courseId: string): Promise<ActionResult> {
  const user = await requireUser();
  const id = idSchema.parse(courseId);
  return run(() => deleteCourse(user.id, id));
}
