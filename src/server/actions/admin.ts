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

/** Demo mode (Admin → Demo data): load or clear the invented "Demo: SAT Math" class. */
export async function demoDataAction(op: "load" | "clear"): Promise<Result> {
  return run(async () => {
    const which = z.enum(["load", "clear"]).parse(op);
    const { clearDemoData, loadDemoData } = await import("../demo-data");
    const { ClassError } = await import("../access");
    try {
      if (which === "clear") {
        const r = await clearDemoData();
        return r.removedUsers ? `Demo data cleared (${r.removedUsers} demo accounts and everything they owned).` : "There was no demo data to clear.";
      }
      await clearDemoData();
      const r = await loadDemoData();
      return `Demo data loaded: "Demo: SAT Math" with ${r.students} students.`;
    } catch (err) {
      if (err instanceof ClassError) throw new GenerationError(err.message);
      throw err;
    }
  });
}

/** Admin → Program access: add or change a rule for an email and a program. */
export async function setAccessRuleAction(input: { email: string; programId: string; mode: string; note?: string }): Promise<Result> {
  const admin = await requireAdmin();
  const parsed = z.object({ email: z.string().max(254), programId: id, mode: z.enum(["ONLY", "BLOCKED"]), note: z.string().max(200).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the email, program and rule." };
  const { AccessRuleError, setAccessRule } = await import("../program-access");
  try {
    const message = await setAccessRule(admin.id, parsed.data);
    revalidatePath("/admin");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof AccessRuleError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function removeAccessRuleAction(ruleId: string): Promise<Result> {
  return run(async () => {
    const { removeAccessRule } = await import("../program-access");
    await removeAccessRule(id.parse(ruleId));
    return "Rule removed.";
  });
}

/** Admin → Email: send a test email to the admin, showing exactly what went wrong if it fails. */
export async function sendTestEmailAction(): Promise<Result> {
  const admin = await requireAdmin();
  const { sendEmail, emailStatus } = await import("../email");
  const status = emailStatus();
  if (!status.canSend) return { ok: false, error: "Email isn't set up on this server yet: set RESEND_API_KEY (or the SMTP settings) and EMAIL_FROM, then redeploy." };
  try {
    const { testEmailMessage } = await import("../email/templates");
    const { env } = await import("../env");
    await sendEmail(testEmailMessage({ to: admin.email, detail: status.detail, from: status.from, url: `${env.APP_URL}/admin` }));
    return { ok: true, message: `Sent to ${admin.email}. Check that inbox (and its spam folder).` };
  } catch (err) {
    return { ok: false, error: `Not sent: ${err instanceof Error ? err.message : String(err)}` };
  }
}
