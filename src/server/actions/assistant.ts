"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ClassError } from "../access";
import * as cur from "../curriculum";
import * as asst from "../assistant";

/** Server Actions for the curriculum and the assistant. The functions they call check role and scope. */

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

export async function importCurriculumAction(classId: string, input: { text?: string; template?: boolean; title?: string }) {
  const p = z.object({ text: z.string().max(40_000).optional(), template: z.boolean().optional(), title: z.string().max(200).optional() }).parse(input);
  return run(async (u) => ({ curriculumId: (await cur.importCurriculum(u, id.parse(classId), p)).id }), [`/teach/${classId}/curriculum`]);
}
export async function updateUnitAction(classId: string, unitId: string, patch: { title?: string; startsOn?: string; endsOn?: string; notes?: string; domains?: string[] }) {
  const p = z.object({ title: z.string().max(200).optional(), startsOn: z.string().max(20).optional(), endsOn: z.string().max(20).optional(), notes: z.string().max(2000).optional(), domains: z.array(z.string().max(40)).max(8).optional() }).parse(patch);
  return run((u) => cur.updateUnit(u, id.parse(unitId), p), [`/teach/${classId}/curriculum`]);
}
export async function publishCurriculumAction(classId: string, curriculumId: string) {
  return run((u) => cur.publishCurriculum(u, id.parse(curriculumId)), [`/teach/${classId}/curriculum`, "/classes"]);
}
export async function suggestionAction(classId: string, key: string, accept: boolean) {
  return run((u) => cur.actOnSuggestion(u, id.parse(classId), z.string().max(100).parse(key), z.boolean().parse(accept)), [`/teach/${classId}/curriculum`]);
}
export async function setCalendarAction(programId: string, input: { termStart?: string | null; termEnd?: string | null; closedDates?: string[] }) {
  const p = z.object({ termStart: z.string().max(20).nullable().optional(), termEnd: z.string().max(20).nullable().optional(), closedDates: z.array(z.string().max(20)).max(200).optional() }).parse(input);
  return run((u) => cur.setCalendar(u, id.parse(programId), p), [`/teach/programs/${programId}`]);
}

export async function draftQuestionsAction(classId: string, input: { domain: string; skill?: string; difficulty: "EASY" | "MEDIUM" | "HARD"; count: number }) {
  const p = z.object({ domain: z.string().max(40), skill: z.string().max(200).optional(), difficulty: z.enum(["EASY", "MEDIUM", "HARD"]), count: z.number().int() }).parse(input);
  return run(async (u) => ({ worksheetId: (await asst.draftQuestions(u, id.parse(classId), p)).id }), ["/teach/worksheets", "/teach/review"]);
}
export async function approveDraftItemsAction(worksheetId: string, itemIds: string[] | "all") {
  const p = itemIds === "all" ? "all" : z.array(id).max(200).parse(itemIds);
  return run(async (u) => ({ approved: await asst.approveDraftItems(u, id.parse(worksheetId), p) }), [`/teach/worksheets/${worksheetId}`, "/teach/review"]);
}
export async function draftLessonAction(classId: string, input: { domain: string; skill?: string }) {
  const p = z.object({ domain: z.string().max(40), skill: z.string().max(200).optional() }).parse(input);
  return run(async (u) => ({ lessonId: (await asst.draftLesson(u, id.parse(classId), p)).id }), [`/teach/${classId}/assistant`, "/teach/review"]);
}
export async function updateLessonAction(classId: string, lessonId: string, patch: { title?: string; content?: string }) {
  const p = z.object({ title: z.string().max(200).optional(), content: z.string().max(40_000).optional() }).parse(patch);
  return run((u) => asst.updateLesson(u, id.parse(lessonId), p), [`/teach/${classId}/assistant`]);
}
export async function approveLessonAction(classId: string, lessonId: string, approve: boolean) {
  return run((u) => asst.approveLesson(u, id.parse(lessonId), z.boolean().parse(approve)), [`/teach/${classId}/assistant`, "/teach/review", "/classes"]);
}
export async function deleteLessonAction(classId: string, lessonId: string) {
  return run((u) => asst.deleteLesson(u, id.parse(lessonId)), [`/teach/${classId}/assistant`, "/teach/review"]);
}
export async function generateSummaryAction(classId: string, groupId: string | null) {
  return run(async (u) => {
    await asst.generateSummary(u, id.parse(classId), { groupId: groupId ? id.parse(groupId) : null });
  }, [`/teach/${classId}/assistant`]);
}
export async function askAction(classId: string, question: string) {
  return run(async (u) => asst.askAboutClass(u, id.parse(classId), z.string().max(500).parse(question)));
}
