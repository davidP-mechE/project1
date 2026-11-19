"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import { BankError } from "../bank";
import * as reports from "../question-reports";

/** Server Actions for question reports. The functions they call check access. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const reason = z.enum(reports.REPORT_REASONS);

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ClassError || err instanceof BankError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function reportQuestionAction(target: reports.ReportTarget, input: { reason: string; note?: string }) {
  const t = z.union([z.object({ kind: z.literal("bank"), sessionId: id, questionId: id }), z.object({ kind: z.literal("item"), assignmentId: id, itemId: id })]).parse(target);
  const p = z.object({ reason, note: z.string().max(2000).optional() }).parse(input);
  return run(async (u) => void (await reports.reportQuestion(u, t, p)));
}
const key = z.string().regex(/^(bank|item):[\w-]{1,64}$/);
export async function resolveReportsAction(k: string, resolution: "FIXED" | "NO_CHANGE") {
  return run((u) => reports.resolveReports(u, key.parse(k), z.enum(["FIXED", "NO_CHANGE"]).parse(resolution)), ["/teach/question-reports"]);
}
export async function unpublishReportedAction(k: string) {
  return run((u) => reports.unpublishReported(u, key.parse(k)), ["/teach/question-reports", "/bank"]);
}
