"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, retryAssessment, retryBook, retryLessons, setUserPlan } from "../admin";
import { GenerationError } from "../generation/lessons";
import { LimitError } from "../limits";

const id = z.string().min(1).max(64);
type Result = { ok: true; message?: string } | { ok: false; error: string };

async function run(fn: (adminId: string) => Promise<string | void>): Promise<Result> {
  const admin = await requireAdmin();
  try {
    const message = await fn(admin.id);
    revalidatePath("/admin");
    return { ok: true, message: message ?? undefined };
  } catch (err) {
    if (err instanceof GenerationError || err instanceof LimitError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: "Invalid request." };
    console.error(err);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function setPlanAction(userId: string, plan: string): Promise<Result> {
  return run(async (adminId) => {
    await setUserPlan(adminId, id.parse(userId), z.enum(["FREE", "PRO"]).parse(plan));
    return `Plan set to ${plan}.`;
  });
}

export async function retryBookAction(bookId: string): Promise<Result> {
  return run(async (adminId) => {
    const r = await retryBook(adminId, id.parse(bookId));
    if (!r.ok) throw new GenerationError(r.error);
    return "Processing queued again.";
  });
}

export async function retryLessonsAction(courseId: string): Promise<Result> {
  return run(async (adminId) => {
    const r = await retryLessons(adminId, id.parse(courseId));
    return `${r.queued} lesson${r.queued === 1 ? "" : "s"} queued again.`;
  });
}

export async function retryAssessmentAction(assessmentId: string): Promise<Result> {
  return run(async (adminId) => {
    await retryAssessment(adminId, id.parse(assessmentId));
    return "Queued again.";
  });
}
