"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as scores from "../scores";
import * as external from "../external";

/** Server Actions for scores and College Board practice. The functions they call check role and scope. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ClassError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const paths = (classId?: string, studentId?: string) => ["/scores", "/dashboard", ...(classId ? [`/teach/${classId}/scores`, ...(studentId ? [`/teach/${classId}/students/${studentId}`] : [])] : [])];

export async function addScoreAction(input: unknown, target?: { classId: string; studentId: string }) {
  return run(async (u) => ({ scoreId: await scores.addScore(u, target ? id.parse(target.studentId) : u, input, { classId: target ? id.parse(target.classId) : undefined }) }), paths(target?.classId, target?.studentId));
}
export async function updateScoreAction(scoreId: string, input: unknown, classId?: string) {
  return run((u) => scores.updateScore(u, id.parse(scoreId), input, { classId: classId ? id.parse(classId) : undefined }), paths(classId));
}
export async function deleteScoreAction(scoreId: string, classId?: string) {
  return run((u) => scores.deleteScore(u, id.parse(scoreId), { classId: classId ? id.parse(classId) : undefined }), paths(classId));
}
export async function verifyScoreAction(classId: string, scoreId: string, studentId: string) {
  return run((u) => scores.verifyScore(u, id.parse(classId), id.parse(scoreId)), paths(classId, studentId));
}
export async function setProfileAction(patch: { targetScore?: number | null; testDate?: string | null; baselinePending?: boolean }) {
  const p = z.object({ targetScore: z.number().int().nullable().optional(), testDate: z.string().max(40).nullable().optional(), baselinePending: z.boolean().optional() }).strict().parse(patch);
  return run((u) => scores.setProfile(u, p), ["/scores", "/dashboard", "/classes"]);
}

export async function assignExternalAction(classId: string, input: { title: string; items: unknown; note?: string; dueAt?: string | null }) {
  const p = z.object({ title: z.string().max(200), items: z.unknown(), note: z.string().max(2000).optional(), dueAt: z.string().max(40).nullable().optional() }).parse(input);
  return run(async (u) => ({ assignmentId: (await external.assignExternal(u, id.parse(classId), p)).id }), [`/teach/${classId}`]);
}
export async function recordExternalAction(assignmentId: string, itemKey: string, input: unknown) {
  return run((u) => external.recordExternal(u, id.parse(assignmentId), z.string().max(40).parse(itemKey), input), [`/classes/assignments/${assignmentId}`, "/classes"]);
}
