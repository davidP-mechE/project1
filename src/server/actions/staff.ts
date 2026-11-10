"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as staff from "../staff";
import * as groups from "../groups";
import * as programs from "../programs";
import * as review from "../grade-review";

/**
 * Server Actions for staff, groups, programs and AI grade review. The server
 * functions they call check role and scope on every call.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const ids = z.array(id).max(500);
const scope = z.object({
  role: z.enum(["TEACHER", "SPECIALIST", "VIEWER"]),
  sections: z.array(z.string().max(10)).max(4).optional(),
  domains: z.array(z.string().max(40)).max(20).optional(),
  groupIds: ids.max(40).optional(),
  canManageStaff: z.boolean().optional(),
});

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

// ── Staff ──
export async function addStaffAction(classId: string, email: string, input: staff.StaffInput) {
  return run(async (u) => ({ result: await staff.addStaff(u, id.parse(classId), z.string().max(254).parse(email), scope.parse(input)) }), [`/teach/${classId}/staff`]);
}
export async function updateStaffAction(classId: string, userId: string, input: staff.StaffInput) {
  return run((u) => staff.updateStaff(u, id.parse(classId), id.parse(userId), scope.parse(input)), [`/teach/${classId}/staff`]);
}
export async function removeStaffAction(classId: string, userId: string) {
  return run((u) => staff.removeStaff(u, id.parse(classId), id.parse(userId)), [`/teach/${classId}/staff`, "/teach"]);
}
export async function resetStaffTwoFactorAction(classId: string, userId: string) {
  return run((u) => staff.resetStaffTwoFactor(u, id.parse(classId), id.parse(userId)), [`/teach/${classId}/staff`]);
}
export async function resendStaffInviteAction(classId: string, inviteId: string) {
  return run((u) => staff.resendStaffInvite(u, id.parse(classId), id.parse(inviteId)), [`/teach/${classId}/staff`]);
}
export async function cancelStaffInviteAction(classId: string, inviteId: string) {
  return run((u) => staff.cancelStaffInvite(u, id.parse(classId), id.parse(inviteId)), [`/teach/${classId}/staff`]);
}
export async function acceptStaffInviteAction(token: string) {
  return run(async (u) => ({ classId: await staff.acceptStaffInvite(u, z.string().min(10).max(100).parse(token)) }), ["/teach"]);
}

// ── Groups ──
export async function createGroupAction(classId: string, name: string, studentIds: string[]) {
  return run(async (u) => ({ groupId: (await groups.createGroup(u, id.parse(classId), z.string().max(200).parse(name), ids.parse(studentIds))).id }), [`/teach/${classId}/groups`]);
}
export async function updateGroupAction(classId: string, groupId: string, patch: { name?: string; studentIds?: string[] }) {
  return run((u) => groups.updateGroup(u, id.parse(classId), id.parse(groupId), z.object({ name: z.string().max(200).optional(), studentIds: ids.optional() }).parse(patch)), [`/teach/${classId}/groups`]);
}
export async function deleteGroupAction(classId: string, groupId: string) {
  return run((u) => groups.deleteGroup(u, id.parse(classId), id.parse(groupId)), [`/teach/${classId}/groups`]);
}

// ── Programs ──
export async function createProgramAction(name: string) {
  return run(async (u) => ({ programId: (await programs.createProgram(u, z.string().max(200).parse(name))).id }), ["/teach"]);
}
export async function updateProgramAction(programId: string, patch: { name?: string; targets?: number[]; inviteDays?: number; aiDailyCapCents?: number | null }) {
  const p = z.object({ name: z.string().max(200).optional(), targets: z.array(z.number()).max(4).optional(), inviteDays: z.number().int().optional(), aiDailyCapCents: z.number().int().nullable().optional() }).parse(patch);
  return run((u) => programs.updateProgram(u, id.parse(programId), p), [`/teach/programs/${programId}`]);
}
export async function transferAdminAction(programId: string, toUserId: string, confirmName: string) {
  return run((u) => programs.transferAdmin(u, id.parse(programId), { toUserId: id.parse(toUserId), confirmName: z.string().max(200).parse(confirmName) }), ["/teach", `/teach/programs/${programId}`]);
}

// ── AI grade review ──
export async function regradeQuestionAction(classId: string, assignmentId: string, itemId: string) {
  return run((u) => review.regradeQuestion(u, id.parse(assignmentId), id.parse(itemId)), [`/teach/${classId}/assignments/${assignmentId}`]);
}
export async function reviewGradeAction(classId: string, answerId: string, input: { score?: number; feedback?: string }) {
  return run((u) => review.reviewAiGrade(u, id.parse(answerId), z.object({ score: z.number().min(0).max(1).optional(), feedback: z.string().max(2000).optional() }).parse(input)), [`/teach/${classId}/review`]);
}
