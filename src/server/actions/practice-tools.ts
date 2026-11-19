"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError, RateLimitError } from "../courses";
import { ClassError } from "../access";
import * as auto from "../auto-practice";
import * as groups from "../small-groups";
import * as live from "../live";
import { assignQuestions, assignSetToClasses } from "../classes";

/** Server Actions for weekly practice, small groups, live runs and assigning worksets. The functions they call check role and scope. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const ids = z.array(id).max(500);

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ClassError || err instanceof RateLimitError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: err.message.startsWith("No open run") ? err.message : "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ─── Weekly practice ─────────────────────────────────────────────────────

export async function autoRemoveQuestionAction(classId: string, itemId: string, questionId: string) {
  return run((u) => auto.removeQuestion(u, id.parse(itemId), id.parse(questionId)), [`/teach/${classId}/weekly`]);
}
export async function autoSwapQuestionAction(classId: string, itemId: string, questionId: string) {
  return run(async (u) => ({ swappedIn: await auto.swapQuestion(u, id.parse(itemId), id.parse(questionId)) }), [`/teach/${classId}/weekly`]);
}
export async function autoSetRemovedAction(classId: string, itemId: string, removed: boolean) {
  return run((u) => auto.setItemRemoved(u, id.parse(itemId), z.boolean().parse(removed)), [`/teach/${classId}/weekly`]);
}
export async function autoBuildNowAction(classId: string) {
  return run(async (u) => {
    const r = await auto.buildBatchNow(u, id.parse(classId));
    return { made: r?.made ?? 0, skipped: r?.skipped ?? 0 };
  }, [`/teach/${classId}/weekly`]);
}
export async function autoApproveAction(classId: string, batchId: string, dueAt: string) {
  return run((u) => auto.approveBatch(u, id.parse(classId), { batchId: id.parse(batchId), dueAt: z.string().max(40).parse(dueAt) }), [`/teach/${classId}/weekly`, `/teach/${classId}`]);
}

// ─── Small groups ────────────────────────────────────────────────────────

const groupInput = z.object({ classIds: ids.min(1), studentIds: ids.min(1) });
export async function messageSmallGroupAction(input: { classIds: string[]; studentIds: string[]; body: string }) {
  const p = groupInput.extend({ body: z.string().max(10_000) }).parse(input);
  return run((u) => groups.messageSmallGroup(u, p), ["/messages"]);
}
export async function assignSmallGroupAction(input: { classIds: string[]; studentIds: string[]; setId: string; dueAt: string | null }) {
  const p = groupInput.extend({ setId: id, dueAt: z.string().max(40).nullable() }).parse(input);
  return run((u) => groups.assignSmallGroup(u, p));
}
export async function sessionForSmallGroupAction(input: { classId: string; studentIds: string[]; skill: string; startsAt: string; minutes: number }) {
  const p = z.object({ classId: id, studentIds: ids.min(1), skill: z.string().max(200), startsAt: z.string().max(40), minutes: z.number().int() }).parse(input);
  return run((u) => groups.sessionForSmallGroup(u, p), [`/teach/${p.classId}/attendance`, `/teach/${p.classId}/groups`]);
}

// ─── Live runs ───────────────────────────────────────────────────────────

export async function startLiveAction(classId: string, input: { setId: string; kind: string; sessionId?: string | null; groupIds?: string[] }) {
  const p = z.object({ setId: id, kind: z.enum(["WARM_UP", "EXIT_TICKET"]), sessionId: id.nullable().optional(), groupIds: ids.optional() }).parse(input);
  return run(async (u) => ({ runId: (await live.startLiveRun(u, id.parse(classId), p)).id }), [`/teach/${classId}/live`]);
}
export async function revealLiveAction(runId: string, questionId: string) {
  return run((u) => live.revealLive(u, id.parse(runId), questionId === "all" ? "all" : id.parse(questionId)));
}
export async function closeLiveAction(runId: string) {
  return run(async (u) => live.closeLive(u, id.parse(runId)));
}
export async function answerLiveAction(runId: string, questionId: string, answer: string) {
  return run((u) => live.answerLive(u, id.parse(runId), id.parse(questionId), z.string().max(40).parse(answer)));
}
export async function joinLiveAction(code: string) {
  return run(async (u) => ({ runId: await live.joinByCode(u, z.string().max(20).parse(code)) }));
}

// ─── Worksets ────────────────────────────────────────────────────────────

/** A whole worksheet (all its questions) to one class, its groups or chosen students. */
export async function assignWorksheetAction(classId: string, input: { worksheetId: string; title?: string; dueAt?: string | null; timeLimitMin?: number | null; targets?: { groupIds: string[]; studentIds: string[] } }) {
  const p = z.object({ worksheetId: id, title: z.string().max(200).optional(), dueAt: z.string().max(40).nullable().optional(), timeLimitMin: z.number().int().nullable().optional(), targets: z.object({ groupIds: ids, studentIds: ids }).optional() }).parse(input);
  return run(async (u) => {
    const a = await assignQuestions(u, { classIds: [id.parse(classId)], worksheetId: p.worksheetId, itemIds: [], title: p.title ?? "", dueAt: p.dueAt ?? null, timeLimitMin: p.timeLimitMin ?? null, targets: p.targets });
    return { count: a.length };
  }, [`/teach/${classId}`]);
}

/** One published set to several whole classes at once. */
export async function assignSetToClassesAction(input: { setId: string; classIds: string[]; dueAt?: string | null; calculator?: "ALLOWED" | "BY_HAND"; timeLimitMin?: number | null }) {
  const p = z.object({ setId: id, classIds: ids.min(1).max(30), dueAt: z.string().max(40).nullable().optional(), calculator: z.enum(["ALLOWED", "BY_HAND"]).optional(), timeLimitMin: z.number().int().nullable().optional() }).parse(input);
  return run(async (u) => ({ count: (await assignSetToClasses(u, p)).length }));
}
