"use server";

import { z } from "zod";
import { getSession } from "../session";
import { rateLimit } from "../rate-limit";
import { reportProblem } from "../monitoring";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { revalidatePath } from "next/cache";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import { requireAdmin } from "../admin";
import { deleteAccountCompletely, purgeStudentFromProgram } from "../student-data";
import { resolveProblem } from "../monitoring";
import { db } from "../db";


const Body = z.object({ path: z.string().max(500), userAgent: z.string().max(500), errorIds: z.array(z.string().max(64)).max(10), note: z.string().max(2000) }).strict();

/** "Report a problem" (works logged out too, e.g. from the login page). */
export async function reportProblemAction(input: { path: string; userAgent: string; errorIds: string[]; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = Body.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the form." };
  const session = await getSession();
  const limited = await rateLimit(RATE_RULES.clientReport, session?.user.id ?? "anonymous");
  if (!limited.ok) return { ok: false, error: "Too many reports right now. Please try again later." };
  await reportProblem(session?.user.id ?? null, parsed.data);
  return { ok: true };
}

// ── Student data and the admin's problem list ──

type Result = { ok: true } | { ok: false; error: string };
const fail = (err: unknown): Result => {
  if (err instanceof ClassError || err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
};

export async function purgeStudentAction(programId: string, studentId: string, confirmName: string): Promise<Result> {
  const user = await requireUser();
  try {
    await purgeStudentFromProgram(user.id, z.string().max(64).parse(programId), z.string().max(64).parse(studentId), z.string().max(200).parse(confirmName));
    revalidatePath("/teach");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteAccountAction(email: string, confirmEmail: string): Promise<Result> {
  const admin = await requireAdmin();
  try {
    await deleteAccountCompletely(admin.id, z.string().max(254).parse(email), z.string().max(254).parse(confirmEmail));
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function resolveProblemAction(kind: "error" | "report", id: string): Promise<Result> {
  await requireAdmin();
  await resolveProblem(z.enum(["error", "report"]).parse(kind), z.string().max(64).parse(id));
  revalidatePath("/admin");
  return { ok: true };
}

/** First-login walkthroughs: remember that this one has been seen. */
export async function markTourSeenAction(tour: string): Promise<Result> {
  const user = await requireUser();
  const t = z.enum(["student", "staff"]).parse(tour);
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { toursSeen: true } });
  if (!u.toursSeen.includes(t)) await db.user.update({ where: { id: user.id }, data: { toursSeen: [...u.toursSeen, t] } });
  return { ok: true };
}
