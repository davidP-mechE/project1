"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import * as classes from "../classes";
import * as worksheets from "../worksheets";

/**
 * Server Actions for classes and worksheets. Every one checks who's asking
 * (the functions they call check the user is the class's teacher or a member).
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof classes.ClassError || err instanceof worksheets.WorksheetError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
  if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    return fail(err);
  }
}

// ── Teacher: classes ──
export async function createClassAction(name: string) {
  return run(async (u) => ({ classId: (await classes.createClass(u, z.string().max(200).parse(name))).id }), ["/teach"]);
}
export async function updateClassAction(classId: string, patch: { name?: string; archived?: boolean; newCode?: boolean }) {
  return run((u) => classes.updateClass(u, id.parse(classId), patch), ["/teach", `/teach/${classId}`]);
}
export async function inviteStudentsAction(classId: string, emails: string) {
  return run((u) => classes.inviteStudents(u, id.parse(classId), z.string().max(20_000).parse(emails)), [`/teach/${classId}/students`]);
}
export async function cancelInviteAction(classId: string, inviteId: string) {
  return run((u) => classes.cancelInvite(u, id.parse(classId), id.parse(inviteId)), [`/teach/${classId}/students`]);
}
export async function removeStudentAction(classId: string, studentId: string) {
  return run((u) => classes.removeStudent(u, id.parse(classId), id.parse(studentId)), [`/teach/${classId}`, `/teach/${classId}/students`]);
}

// ── Teacher: assignments ──
const due = z.string().max(40).nullable().optional();
export async function assignLessonsAction(classId: string, input: { courseId: string; lessonIds: string[]; title?: string; note?: string; dueAt?: string | null; subject?: string | null; targets?: { groupIds: string[]; studentIds: string[] } }) {
  const parsed = z.object({ courseId: id, lessonIds: z.array(id).max(500), title: z.string().max(200).optional(), note: z.string().max(2000).optional(), dueAt: due, subject: z.string().max(40).nullable().optional(), targets: z.object({ groupIds: z.array(id).max(40), studentIds: z.array(id).max(500) }).optional() }).parse(input);
  // "MATH"/"RW" is a whole section; anything else is one domain.
  const subject = parsed.subject === "MATH" || parsed.subject === "RW" ? { section: parsed.subject, domains: [] } : parsed.subject ? { section: null, domains: [parsed.subject] } : {};
  return run(async (u) => ({ assignmentId: (await classes.assignLessons(u, id.parse(classId), { ...parsed, ...subject })).id }), [`/teach/${classId}`]);
}
export async function assignQuestionsAction(input: classes.QuestionAssignmentInput) {
  const parsed = z
    .object({
      classIds: z.array(id).min(1).max(50),
      worksheetId: id,
      itemIds: z.array(id).max(500),
      title: z.string().max(200),
      courseId: id.nullable().optional(),
      note: z.string().max(2000).optional(),
      dueAt: due,
      timeLimitMin: z.number().int().nullable().optional(),
    })
    .parse(input);
  return run(async (u) => ({ count: (await classes.assignQuestions(u, parsed)).length }), ["/teach", `/teach/worksheets/${parsed.worksheetId}`, ...parsed.classIds.map((c) => `/teach/${c}`)]);
}
export async function updateAssignmentAction(classId: string, assignmentId: string, patch: { title?: string; dueAt?: string | null; note?: string }) {
  return run((u) => classes.updateAssignment(u, id.parse(assignmentId), patch), [`/teach/${classId}`, `/teach/${classId}/assignments/${assignmentId}`]);
}
export async function deleteAssignmentAction(classId: string, assignmentId: string) {
  return run((u) => classes.deleteAssignment(u, id.parse(assignmentId)), [`/teach/${classId}`]);
}

// ── Students ──
export async function joinClassAction(code: string) {
  return run(async (u) => ({ classId: await classes.joinClass(u, z.string().max(40).parse(code)) }), ["/classes", "/dashboard"]);
}
export async function leaveClassAction(classId: string) {
  return run((u) => classes.leaveClass(u, id.parse(classId)), ["/classes", "/dashboard"]);
}
export async function startLessonsAction(assignmentId: string) {
  return run(async (u) => {
    const r = await classes.startLessons(u, id.parse(assignmentId));
    return { url: r.lessonId ? `/courses/${r.courseId}/lessons/${r.lessonId}` : `/courses/${r.courseId}` };
  });
}
export async function startQuestionsAction(assignmentId: string) {
  return run((u) => classes.startQuestions(u, id.parse(assignmentId)), [`/classes/assignments/${assignmentId}`]);
}
export async function handInAction(assignmentId: string) {
  return run((u) => classes.handIn(u, id.parse(assignmentId)), [`/classes/assignments/${assignmentId}`, "/classes"]);
}

// ── Worksheets ──
const itemEdit = z.object({
  type: z.enum(["MULTIPLE_CHOICE", "SHORT_ANSWER", "STEP_BY_STEP"]),
  prompt: z.string().max(20_000),
  choices: z.array(z.string().max(2000)).max(8),
  correctChoice: z.number().int().nullable(),
  answer: z.string().max(5000),
  explanation: z.string().max(5000),
  topic: z.string().max(60),
});
export async function updateItemAction(worksheetId: string, itemId: string, edit: worksheets.ItemEdit) {
  return run((u) => worksheets.updateWorksheetItem(u, id.parse(itemId), itemEdit.parse(edit)), [`/teach/worksheets/${worksheetId}`]);
}
const tagEdit = z.object({ domain: z.string().max(40).nullable(), skill: z.string().max(200).nullable(), difficulty: z.string().max(10).nullable(), desmosSolvable: z.boolean() });
export async function setItemTagsAction(worksheetId: string, itemId: string, edit: worksheets.TagEdit) {
  return run((u) => worksheets.setItemTags(u, id.parse(itemId), tagEdit.parse(edit)), [`/teach/worksheets/${worksheetId}`]);
}
export async function confirmAllTagsAction(worksheetId: string) {
  return run((u) => worksheets.confirmAllTags(u, id.parse(worksheetId)), [`/teach/worksheets/${worksheetId}`]);
}
export async function deleteItemAction(worksheetId: string, itemId: string) {
  return run((u) => worksheets.deleteWorksheetItem(u, id.parse(itemId)), [`/teach/worksheets/${worksheetId}`]);
}
export async function renameWorksheetAction(worksheetId: string, title: string) {
  return run((u) => worksheets.renameWorksheet(u, id.parse(worksheetId), z.string().max(200).parse(title)), [`/teach/worksheets/${worksheetId}`, "/teach/worksheets"]);
}
export async function deleteWorksheetAction(worksheetId: string) {
  return run((u) => worksheets.deleteWorksheet(u, id.parse(worksheetId)), ["/teach/worksheets"]);
}
export async function retryWorksheetAction(worksheetId: string) {
  return run((u) => worksheets.retryWorksheet(u, id.parse(worksheetId)), [`/teach/worksheets/${worksheetId}`]);
}

// ── The 1600 Project: practice-test logs and bank sets ──
const targets = z.object({ groupIds: z.array(id).max(200), studentIds: z.array(id).max(500) }).partial().optional();

export async function assignLogTestAction(classId: string, input: unknown) {
  const p = z.object({ testId: id, title: z.string().max(200).optional(), note: z.string().max(2000).optional(), dueAt: z.string().max(40).nullable().optional(), targets }).parse(input);
  return run(async (u) => ({ assignmentId: (await classes.assignLogTest(u, id.parse(classId), p)).id }), [`/teach/${classId}`, "/classes"]);
}
export async function assignQuestionSetAction(classId: string, input: unknown) {
  const p = z
    .object({ setId: id, title: z.string().max(200).optional(), note: z.string().max(2000).optional(), dueAt: z.string().max(40).nullable().optional(), timeLimitMin: z.number().int().nullable().optional(), calculator: z.enum(["ALLOWED", "BY_HAND"]).optional(), targets })
    .parse(input);
  return run(async (u) => ({ assignmentId: (await classes.assignQuestionSet(u, id.parse(classId), p)).id }), [`/teach/${classId}`, "/classes"]);
}
export async function commentOnAttemptAction(classId: string, attemptId: string, body: string) {
  return run(async (u) => {
    const { addAttemptComment } = await import("../tutor-view");
    await addAttemptComment(u, id.parse(classId), id.parse(attemptId), z.string().max(2000).parse(body));
  }, [`/teach/${classId}/attempts/${attemptId}`]);
}
