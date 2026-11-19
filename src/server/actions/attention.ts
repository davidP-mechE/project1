"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as attention from "../attention";
import * as caseloads from "../caseloads";
import { assignQuestionSet } from "../classes";
import { updateProgram } from "../programs";

/** Server Actions for "needs attention" and caseloads. The functions they call check role and scope. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const reason = z.enum(attention.REASONS);

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

export async function markAttentionAction(input: { classId: string; studentId: string; reason: string; action: "HANDLED" | "SNOOZED"; days?: number }) {
  const p = z.object({ classId: id, studentId: id, reason, action: z.enum(["HANDLED", "SNOOZED"]), days: z.number().int().min(1).max(30).optional() }).parse(input);
  return run((u) => attention.markAttention(u, p), ["/teach/attention", "/dashboard"]);
}

export async function reopenAttentionAction(input: { classId: string; studentId: string; reason: string }) {
  const p = z.object({ classId: id, studentId: id, reason }).parse(input);
  return run((u) => attention.reopenAttention(u, p), ["/teach/attention"]);
}

/** Practice sets to offer for one item (published sets on the skill, else any published set). */
export async function practiceOptionsAction(skillId: string | null) {
  const s = id.nullable().parse(skillId);
  return run(async () => ({ sets: (await attention.setsForSkill(s)).length ? await attention.setsForSkill(s) : await attention.setsForSkill(null) }));
}

/** Assign a published set to one student, due in a week (or the days chosen). */
export async function assignPracticeAction(input: { classId: string; studentId: string; setId: string; days?: number }) {
  const p = z.object({ classId: id, studentId: id, setId: id, days: z.number().int().min(1).max(30).optional() }).parse(input);
  return run(async (u) => {
    const due = new Date(Date.now() + (p.days ?? 7) * 86_400_000);
    const a = await assignQuestionSet(u, p.classId, { setId: p.setId, dueAt: due, targets: { studentIds: [p.studentId], groupIds: [] } });
    attention.forgetAttentionCounts();
    return { assignmentId: a.id };
  }, ["/teach/attention", `/teach/${p.classId}`]);
}

export async function assignTutorAction(programId: string, studentIds: string[], tutorId: string | null) {
  const p = z.object({ programId: id, studentIds: z.array(id).min(1).max(2000), tutorId: id.nullable() }).parse({ programId, studentIds, tutorId });
  return run((u) => caseloads.assignTutor(u, p.programId, p.studentIds, p.tutorId), [`/teach/programs/${programId}/caseloads`]);
}

export async function assignTutorToClassAction(programId: string, input: { classId: string; groupId?: string | null; tutorId: string | null }) {
  const p = z.object({ classId: id, groupId: id.nullable().optional(), tutorId: id.nullable() }).parse(input);
  return run((u) => caseloads.assignTutorToClass(u, id.parse(programId), p), [`/teach/programs/${programId}/caseloads`]);
}

export async function importCaseloadAction(programId: string, text: string, commit: boolean) {
  const t = z.string().max(500_000).parse(text);
  return run((u) => caseloads.importCaseloadCsv(u, id.parse(programId), t, z.boolean().parse(commit)), [`/teach/programs/${programId}/caseloads`]);
}

export async function setInactiveDaysAction(programId: string, days: number) {
  const n = z.number().int().min(2).max(60).parse(days);
  return run(async (u) => {
    await updateProgram(u, id.parse(programId), { inactiveDays: n });
    attention.forgetAttentionCounts();
  }, [`/teach/programs/${programId}`, "/teach/attention"]);
}
