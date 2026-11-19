"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError, RateLimitError } from "../courses";
import { ClassError } from "../access";
import * as replies from "../saved-replies";
import * as scheduled from "../scheduled";
import { setGuardianFrequency } from "../guardian-progress";

/** Server Actions for saved replies, scheduled sends and parent progress emails. The functions they call check role and scope. */

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
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const reply = z.object({ title: z.string().max(200), body: z.string().max(10_000), programId: id.nullable().optional() });
export async function createSavedReplyAction(input: { title: string; body: string; programId?: string | null }) {
  const p = reply.parse(input);
  return run(async (u) => ({ id: (await replies.createSavedReply(u, p)).id }), ["/messages/replies"]);
}
export async function updateSavedReplyAction(replyId: string, input: { title: string; body: string; programId?: string | null }) {
  const p = reply.parse(input);
  return run(async (u) => void (await replies.updateSavedReply(u, id.parse(replyId), p)), ["/messages/replies"]);
}
export async function deleteSavedReplyAction(replyId: string) {
  return run((u) => replies.deleteSavedReply(u, id.parse(replyId)), ["/messages/replies"]);
}

export async function scheduleSendAction(input: scheduled.ScheduleInput) {
  const p = z
    .object({ classId: id, kind: z.enum(["MESSAGE", "ANNOUNCEMENT"]), studentIds: ids.optional(), groupIds: ids.optional(), title: z.string().max(500).optional(), groupId: id.nullable().optional(), pinned: z.boolean().optional(), body: z.string().max(10_000), sendAt: z.string().max(40) })
    .parse(input);
  return run(async (u) => ({ id: (await scheduled.scheduleSend(u, p)).id }), ["/messages/scheduled"]);
}
export async function updateScheduledAction(sendId: string, patch: { body?: string; title?: string; sendAt?: string; pinned?: boolean }) {
  const p = z.object({ body: z.string().max(10_000).optional(), title: z.string().max(500).optional(), sendAt: z.string().max(40).optional(), pinned: z.boolean().optional() }).parse(patch);
  return run((u) => scheduled.updateScheduled(u, id.parse(sendId), p), ["/messages/scheduled"]);
}
export async function cancelScheduledAction(sendId: string) {
  return run((u) => scheduled.cancelScheduled(u, id.parse(sendId)), ["/messages/scheduled"]);
}

export async function setGuardianFrequencyAction(programId: string, frequency: string) {
  const f = z.enum(["OFF", "WEEKLY", "MONTHLY"]).parse(frequency);
  return run((u) => setGuardianFrequency(u, id.parse(programId), f), [`/teach/programs/${programId}`]);
}
