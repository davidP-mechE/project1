"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import * as studio from "../studio";

/** Server Actions for the Course Studio. Every function they call checks the caller is the owner (others get "not found"). */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const dir = z.union([z.literal(-1), z.literal(1)]);

async function run<T extends object>(fn: (userId: string) => Promise<T | void>): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    revalidatePath("/studio", "layout");
    revalidatePath("/learn", "layout");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof studio.StudioError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "Not found." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const courseInput = z.object({ title: z.string().max(160).optional(), section: z.string().max(10).optional(), description: z.string().max(4000).optional() });

export async function createCourseAction(input: unknown) {
  const p = courseInput.extend({ title: z.string().max(160) }).parse(input);
  return run(async (u) => ({ courseId: (await studio.createCourse(u, p)).id }));
}
export async function updateCourseAction(courseId: string, input: unknown) {
  return run((u) => studio.updateCourse(u, id.parse(courseId), courseInput.parse(input)).then(() => undefined));
}
export async function publishCourseAction(courseId: string, confirmTitle: string) {
  return run(async (u) => {
    const c = await studio.studioCourse(u, id.parse(courseId));
    if (z.string().max(160).parse(confirmTitle).trim() !== c.title) throw new studio.StudioError("Type the course title exactly to confirm.");
    await studio.publishCourse(u, c.id);
  });
}
export async function unpublishCourseAction(courseId: string) {
  return run((u) => studio.unpublishCourse(u, id.parse(courseId)).then(() => undefined));
}
export async function archiveCourseAction(courseId: string) {
  return run((u) => studio.archiveCourse(u, id.parse(courseId)).then(() => undefined));
}
export async function deleteCourseAction(courseId: string) {
  return run((u) => studio.deleteCourse(u, id.parse(courseId)));
}
export async function addUnitAction(courseId: string, title: string) {
  return run((u) => studio.addUnit(u, id.parse(courseId), z.string().max(160).parse(title)).then(() => undefined));
}
export async function renameUnitAction(unitId: string, title: string) {
  return run((u) => studio.renameUnit(u, id.parse(unitId), z.string().max(160).parse(title)).then(() => undefined));
}
export async function deleteUnitAction(unitId: string) {
  return run((u) => studio.deleteUnit(u, id.parse(unitId)));
}
export async function moveUnitAction(unitId: string, d: number) {
  return run((u) => studio.moveUnit(u, id.parse(unitId), dir.parse(d)));
}
export async function addLessonAction(unitId: string, title: string) {
  return run(async (u) => ({ lessonId: (await studio.addLesson(u, id.parse(unitId), z.string().max(160).parse(title))).id }));
}
export async function updateLessonAction(lessonId: string, input: unknown) {
  const p = z.object({ title: z.string().max(160).optional(), desmosTechnique: z.string().max(40).nullable().optional() }).parse(input);
  return run((u) => studio.updateLesson(u, id.parse(lessonId), p).then(() => undefined));
}
export async function deleteLessonAction(lessonId: string) {
  return run((u) => studio.deleteLesson(u, id.parse(lessonId)));
}
export async function moveLessonAction(lessonId: string, d: number) {
  return run((u) => studio.moveLesson(u, id.parse(lessonId), dir.parse(d)));
}

const block = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markdown"), text: z.string().max(100_000) }),
  z.object({ kind: z.literal("desmos"), state: z.record(z.string(), z.unknown()), interactive: z.boolean(), title: z.string().max(160).optional() }),
  z.object({ kind: z.literal("question_set"), setId: id }),
]);
export async function addBlockAction(lessonId: string, input: unknown) {
  const b = block.parse(input);
  return run(async (u) => ({ blockId: (await studio.addBlock(u, id.parse(lessonId), b)).id }));
}
export async function updateBlockAction(blockId: string, input: unknown) {
  const b = block.parse(input);
  return run((u) => studio.updateBlock(u, id.parse(blockId), b).then(() => undefined));
}
export async function deleteBlockAction(blockId: string) {
  return run((u) => studio.deleteBlock(u, id.parse(blockId)));
}
export async function moveBlockAction(blockId: string, d: number) {
  return run((u) => studio.moveBlock(u, id.parse(blockId), dir.parse(d)));
}
