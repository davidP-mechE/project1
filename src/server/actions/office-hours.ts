"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as oh from "../office-hours";

/** Server Actions for office hours. The functions they call check role and scope. */

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

const rule = z.object({ programId: id, weekday: z.number().int(), start: z.string().max(5), end: z.string().max(5), slotMinutes: z.number().int(), bufferMinutes: z.number().int(), maxPerDay: z.number().int(), validFrom: z.string().max(10), validUntil: z.string().max(10).nullable().optional(), location: z.string().max(300).nullable().optional() });
const PATHS = ["/teach/office-hours", "/office-hours"];

export async function saveRuleAction(input: oh.RuleInput, ruleId?: string) {
  const p = rule.parse(input);
  return run(async (u) => void (await oh.saveRule(u, p, ruleId ? id.parse(ruleId) : undefined)), PATHS);
}
export async function deleteRuleAction(ruleId: string) {
  return run((u) => oh.deleteRule(u, id.parse(ruleId)), PATHS);
}
export async function bookSlotAction(input: { staffId: string; programId: string; start: string; note?: string }) {
  const p = z.object({ staffId: id, programId: id, start: z.string().max(40), note: z.string().max(1000).optional() }).parse(input);
  return run(async (u) => ({ id: (await oh.bookSlot(u, p)).id }), [...PATHS, "/calendar"]);
}
export async function cancelBookingAction(bookingId: string) {
  return run((u) => oh.cancelBooking(u, id.parse(bookingId)), [...PATHS, "/calendar"]);
}
export async function rescheduleBookingAction(bookingId: string, start: string) {
  return run(async (u) => ({ id: (await oh.rescheduleBooking(u, id.parse(bookingId), z.string().max(40).parse(start))).id }), [...PATHS, "/calendar"]);
}
export async function bookingToSessionAction(bookingId: string, attended: boolean) {
  return run((u) => oh.bookingToSession(u, id.parse(bookingId), z.boolean().parse(attended)), PATHS);
}
