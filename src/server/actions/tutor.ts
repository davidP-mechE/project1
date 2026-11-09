"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { deleteThread } from "../tutor/chat";

export async function deleteThreadAction(courseId: string, threadId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await deleteThread(user.id, z.string().min(1).max(64).parse(threadId));
    revalidatePath(`/courses/${z.string().max(64).parse(courseId)}/tutor`);
    return { ok: true };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "That conversation no longer exists." };
    console.error(err);
    return { ok: false, error: "Couldn't delete it. Please try again." };
  }
}
