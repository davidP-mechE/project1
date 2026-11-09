"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { createMissingAssessments, regenerateAssessment } from "../generation/assessments";
import { claudeEnabled } from "../env";
import { LimitError } from "../limits";

const id = z.string().min(1).max(64);

export async function regenerateAssessmentAction(courseId: string, assessmentId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!claudeEnabled) return { ok: false, error: "Writing tests needs an ANTHROPIC_API_KEY on the server." };
  try {
    await regenerateAssessment(user.id, id.parse(assessmentId));
    revalidatePath(`/courses/${id.parse(courseId)}`, "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "That test no longer exists." };
    if (err instanceof LimitError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** For courses written before unit tests existed. */
export async function createAssessmentsAction(courseId: string): Promise<{ ok: boolean; queued?: number; error?: string }> {
  const user = await requireUser();
  if (!claudeEnabled) return { ok: false, error: "Writing tests needs an ANTHROPIC_API_KEY on the server." };
  try {
    const queued = await createMissingAssessments(user.id, id.parse(courseId));
    revalidatePath(`/courses/${courseId}`, "layout");
    return { ok: true, queued };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "That course no longer exists." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
