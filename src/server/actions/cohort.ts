"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as cohort from "../cohort";
import * as roster from "../roster";

/** Server Actions for sessions, attendance, alerts, guardians and rosters. The functions they call check role and scope. */

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

export async function createSessionsAction(classId: string, input: { startsAt: string; minutes: number; weeks?: number; groupId?: string | null; title?: string }) {
  const p = z.object({ startsAt: z.string().max(40), minutes: z.number().int(), weeks: z.number().int().optional(), groupId: id.nullable().optional(), title: z.string().max(200).optional() }).parse(input);
  return run(async (u) => ({ created: await cohort.createSessions(u, id.parse(classId), p) }), [`/teach/${classId}/attendance`]);
}
export async function deleteSessionAction(classId: string, sessionId: string) {
  return run((u) => cohort.deleteSession(u, id.parse(classId), id.parse(sessionId)), [`/teach/${classId}/attendance`]);
}
export async function markAttendanceAction(classId: string, sessionId: string, studentId: string, status: string) {
  return run((u) => cohort.markAttendance(u, id.parse(classId), id.parse(sessionId), id.parse(studentId), z.string().max(12).parse(status)));
}
export async function dismissAlertAction(classId: string, studentId: string, kind: cohort.AlertKind, snoozeDays: number | null) {
  return run((u) => cohort.dismissAlert(u, id.parse(classId), id.parse(studentId), kind, snoozeDays), [`/teach/${classId}/alerts`]);
}
export async function addGuardianAction(classId: string, studentId: string, input: { name: string; email: string; relationship?: string; consent: boolean }) {
  const p = z.object({ name: z.string().max(200), email: z.string().max(254), relationship: z.string().max(60).optional(), consent: z.boolean() }).parse(input);
  return run((u) => cohort.addGuardian(u, id.parse(classId), id.parse(studentId), p), [`/teach/${classId}/students/${studentId}`]);
}
export async function removeGuardianAction(classId: string, studentId: string, guardianId: string) {
  return run((u) => cohort.removeGuardian(u, id.parse(classId), id.parse(guardianId)), [`/teach/${classId}/students/${studentId}`]);
}
export async function setGuardianSummariesAction(classId: string, on: boolean) {
  return run((u) => cohort.setGuardianSummaries(u, id.parse(classId), z.boolean().parse(on)), [`/teach/${classId}/students`]);
}
export async function previewRosterAction(classId: string, text: string) {
  return run(async (u) => ({ rows: await roster.previewRoster(u, id.parse(classId), z.string().max(200_000).parse(text)) }));
}
export async function importRosterAction(classId: string, text: string) {
  return run(async (u) => roster.importRoster(u, id.parse(classId), z.string().max(200_000).parse(text)), [`/teach/${classId}/students`]);
}
