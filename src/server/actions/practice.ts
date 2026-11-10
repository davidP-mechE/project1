"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as diag from "../diagnostics";
import * as mistakes from "../mistakes";

/** Server Actions for diagnostics and the mistake log. The functions they call check role, scope and membership. */

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

const build = z.object({
  title: z.string().max(200),
  sections: z.array(z.enum(["MATH", "RW"])).min(1).max(2),
  m1Count: z.number().int(),
  m2Count: z.number().int(),
  m1Minutes: z.number().int(),
  m2Minutes: z.number().int(),
});

export async function createDiagnosticAction(programId: string, input: diag.BuildInput) {
  return run(async (u) => ({ diagnosticId: (await diag.createDiagnostic(u, id.parse(programId), build.parse(input))).id }), ["/teach/diagnostics"]);
}
export async function publishDiagnosticAction(diagnosticId: string) {
  return run((u) => diag.publishDiagnostic(u, id.parse(diagnosticId)), [`/teach/diagnostics/${diagnosticId}`, "/teach/diagnostics"]);
}
export async function deleteDiagnosticAction(diagnosticId: string) {
  return run((u) => diag.deleteDiagnostic(u, id.parse(diagnosticId)), ["/teach/diagnostics"]);
}
export async function assignDiagnosticAction(classId: string, input: { diagnosticId: string; title?: string; opensAt?: string | null; closesAt?: string | null; targets?: { groupIds: string[]; studentIds: string[] } }) {
  const p = z.object({ diagnosticId: id, title: z.string().max(200).optional(), opensAt: z.string().max(40).nullable().optional(), closesAt: z.string().max(40).nullable().optional(), targets: z.object({ groupIds: z.array(id).max(40), studentIds: z.array(id).max(500) }).optional() }).parse(input);
  return run(async (u) => ({ assignmentId: (await diag.assignDiagnostic(u, id.parse(classId), p)).id }), [`/teach/${classId}`]);
}
export async function grantRetakeAction(classId: string, assignmentId: string, studentId: string) {
  return run((u) => diag.grantRetake(u, id.parse(assignmentId), id.parse(studentId)), [`/teach/${classId}/diagnostics/${assignmentId}`]);
}

export async function startDiagnosticAction(assignmentId: string) {
  return run((u) => diag.startDiagnostic(u, id.parse(assignmentId)), [`/classes/assignments/${assignmentId}`]);
}
export async function answerDiagnosticAction(assignmentId: string, itemId: string, input: { choice?: number; response?: string; timeMs?: number; usedDesmos?: boolean }) {
  const p = z.object({ choice: z.number().int().optional(), response: z.string().max(200).optional(), timeMs: z.number().optional(), usedDesmos: z.boolean().optional() }).strict().parse(input);
  return run((u) => diag.answerDiagnostic(u, id.parse(assignmentId), id.parse(itemId), p));
}
export async function submitModuleAction(assignmentId: string, moduleId: string) {
  return run((u) => diag.submitModule(u, id.parse(assignmentId), id.parse(moduleId)), [`/classes/assignments/${assignmentId}`, "/classes", "/scores"]);
}

export async function answerMistakeAction(mistakeId: string, input: { practiceItemId?: string; choice?: number; response?: string; selfReport?: "CORRECT" | "INCORRECT" }) {
  const p = z.object({ practiceItemId: id.optional(), choice: z.number().int().optional(), response: z.string().max(2000).optional(), selfReport: z.enum(["CORRECT", "INCORRECT"]).optional() }).strict().parse(input);
  return run(async (u) => {
    const r = await mistakes.answerMistake(u, id.parse(mistakeId), p);
    return { correct: r.correct, retired: r.retired, due: r.due.toISOString(), feedback: r.feedback };
  });
}
