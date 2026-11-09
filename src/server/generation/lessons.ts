import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { claudeEnabled } from "../env";
import { NotFoundError } from "../courses";
import { enqueueGeneration } from "../queue";
import { LessonContentSchema, LessonEditSchema, type LessonContent } from "@/lib/ai/lesson-schema";
import { cleanPageRefs } from "@/lib/ai/normalize";
import { syncFlashcards } from "../flashcard-store";

/**
 * What the web app can ask for: start generating a course, regenerate a
 * lesson or its questions, save hand edits, and read lessons and progress.
 * Every function checks the course belongs to the current user.
 */

export class GenerationError extends Error {}

const REGENERATE_PRIORITY = 1; // jumps ahead of a whole-course run

async function ownedCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, status: true } });
  if (!course) throw new NotFoundError("Course not found");
  return course;
}

async function ownedLesson(userId: string, lessonId: string) {
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, course: { userId } },
    include: { course: { select: { id: true, status: true } } },
  });
  if (!lesson) throw new NotFoundError("Lesson not found");
  return lesson;
}

function requireClaude() {
  if (!claudeEnabled) {
    throw new GenerationError("Lesson generation isn't set up on this server yet (no Claude API key). See the README.");
  }
}

/**
 * Start (or continue) writing a course. Lessons that already have content are
 * left alone: nothing is regenerated unless the student asks.
 */
export async function startGeneration(userId: string, courseId: string) {
  requireClaude();
  const course = await ownedCourse(userId, courseId);
  if (!["OUTLINE_DRAFT", "ACTIVE", "GENERATING"].includes(course.status)) {
    throw new GenerationError("This course isn't ready to generate yet.");
  }
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, status: true, content: true },
  });
  if (lessons.length === 0) throw new GenerationError("Every lesson is skipped. Include at least one lesson in the outline.");
  const todo = lessons
    .map((l, index) => ({ ...l, index }))
    .filter((l) => !l.content && ["PENDING", "FAILED"].includes(l.status));

  await db.$transaction([
    db.lesson.updateMany({ where: { id: { in: todo.map((l) => l.id) } }, data: { status: "QUEUED", error: null } }),
    db.course.update({ where: { id: courseId }, data: { status: todo.length > 0 ? "GENERATING" : "ACTIVE" } }),
  ]);
  await enqueueGeneration(todo.map((l) => ({ payload: { kind: "lesson", lessonId: l.id }, priority: 10 + l.index })));
  return { queued: todo.length, total: lessons.length };
}

/** Regenerate every written lesson (e.g. after changing settings). Hand-edited lessons are kept unless included. */
export async function regenerateAll(userId: string, courseId: string, opts: { includeEdited: boolean }) {
  requireClaude();
  await ownedCourse(userId, courseId);
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false, status: { in: ["READY", "FAILED", "FLAGGED", "PENDING"] }, ...(opts.includeEdited ? {} : { userEdited: false }) },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true },
  });
  await db.$transaction([
    db.lesson.updateMany({ where: { id: { in: lessons.map((l) => l.id) } }, data: { status: "QUEUED", error: null } }),
    db.course.update({ where: { id: courseId }, data: { status: lessons.length > 0 ? "GENERATING" : "ACTIVE" } }),
  ]);
  await enqueueGeneration(lessons.map((l, i) => ({ payload: { kind: "lesson", lessonId: l.id, force: true }, priority: 10 + i })));
  return { queued: lessons.length };
}

/** Regenerate one lesson, or only its practice questions. */
export async function regenerateLesson(
  userId: string,
  lessonId: string,
  opts: { mode: "lesson" | "questions"; allowThin?: boolean },
) {
  requireClaude();
  const lesson = await ownedLesson(userId, lessonId);
  if (["QUEUED", "GENERATING"].includes(lesson.status)) return; // already on its way
  if (opts.mode === "questions" && !lesson.content) {
    throw new GenerationError("Generate the lesson first, then you can regenerate its questions.");
  }
  if (opts.mode === "lesson") {
    await db.lesson.update({ where: { id: lessonId }, data: { status: "QUEUED", error: null, flagReason: null, skip: false } });
    if (lesson.course.status !== "GENERATING") {
      await db.course.updateMany({ where: { id: lesson.courseId, status: { in: ["ACTIVE", "OUTLINE_DRAFT"] } }, data: { status: "GENERATING" } });
    }
  } else {
    await db.lesson.update({ where: { id: lessonId }, data: { status: "GENERATING", error: null } });
  }
  await enqueueGeneration([
    { payload: { kind: opts.mode, lessonId, force: true, allowThin: opts.allowThin }, priority: REGENERATE_PRIORITY },
  ]);
}

/** Save a student's hand edits. Edited lessons are never overwritten unless the student regenerates them. */
export async function saveLessonEdits(userId: string, lessonId: string, input: unknown) {
  const lesson = await ownedLesson(userId, lessonId);
  if (["QUEUED", "GENERATING"].includes(lesson.status)) {
    throw new GenerationError("This lesson is being generated right now. Wait for it to finish, then edit.");
  }
  const parsed = LessonEditSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new GenerationError(`Please check the form: ${first?.message ?? "something is invalid"}.`);
  }
  const range = { pageStart: lesson.pageStart, pageEnd: lesson.pageEnd };
  const { content, questions, flashcards } = parsed.data;
  const cleaned: LessonContent = {
    ...content,
    workedExamples: content.workedExamples.map((w) => ({ ...w, pageRefs: cleanPageRefs(w.pageRefs, range) })),
    keyTerms: content.keyTerms.map((k) => ({ ...k, pageRefs: cleanPageRefs(k.pageRefs, range) })),
  };
  await db.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { lessonId, scope: "LESSON" } });
    await tx.question.createMany({
      data: questions.map((q, i) => ({
        ...q,
        correctChoice: q.type === "MULTIPLE_CHOICE" ? q.correctChoice : null,
        choices: q.type === "MULTIPLE_CHOICE" ? q.choices : [],
        steps: q.type === "STEP_BY_STEP" ? q.steps : [],
        pageRefs: cleanPageRefs(q.pageRefs, range),
        courseId: lesson.courseId,
        lessonId,
        scope: "LESSON" as const,
        order: i,
        userEdited: true,
      })),
    });
    // Updates cards in place (by id) so review history isn't lost when fixing a typo.
    await syncFlashcards(tx, { id: lessonId, courseId: lesson.courseId }, flashcards.map((f) => ({ ...f, pageRefs: cleanPageRefs(f.pageRefs, range) })), true);
    await tx.lesson.update({
      where: { id: lessonId },
      data: { content: cleaned as unknown as Prisma.InputJsonValue, userEdited: true, status: "READY", flagReason: null, error: null },
    });
  });
}

/** Everything the lesson page shows. */
export async function getLessonView(userId: string, courseId: string, lessonId: string) {
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, courseId, course: { userId } },
    include: {
      unit: { select: { id: true, title: true, order: true } },
      questions: { where: { scope: "LESSON" }, orderBy: { order: "asc" } },
      flashcards: { orderBy: { order: "asc" } },
    },
  });
  if (!lesson) throw new NotFoundError("Lesson not found");
  // Previous / next among included lessons, in course order.
  const all = await db.lesson.findMany({
    where: { courseId, skip: false },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, title: true },
  });
  const i = all.findIndex((l) => l.id === lessonId);
  const parsed = lesson.content ? LessonContentSchema.safeParse(lesson.content) : null;
  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      pageStart: lesson.pageStart,
      pageEnd: lesson.pageEnd,
      status: lesson.status,
      skip: lesson.skip,
      flagReason: lesson.flagReason,
      error: lesson.error,
      userEdited: lesson.userEdited,
      generatedAt: lesson.generatedAt,
      model: lesson.model,
    },
    unit: lesson.unit,
    content: parsed?.success ? parsed.data : null,
    questions: lesson.questions,
    flashcards: lesson.flashcards,
    position: i >= 0 ? { index: i + 1, total: all.length } : null,
    prev: i > 0 ? all[i - 1] : null,
    next: i >= 0 && i < all.length - 1 ? all[i + 1] : null,
  };
}

/** Counts for "Lesson 14 of 52" and per-lesson status, polled while generating. */
export async function getGenerationProgress(userId: string, courseId: string) {
  const course = await ownedCourse(userId, courseId);
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, title: true, status: true, unitId: true },
  });
  const count = (s: string) => lessons.filter((l) => l.status === s).length;
  const done = count("READY") + count("FLAGGED") + count("FAILED");
  return {
    courseStatus: course.status,
    total: lessons.length,
    ready: count("READY"),
    flagged: count("FLAGGED"),
    failed: count("FAILED"),
    done,
    current: lessons.find((l) => l.status === "GENERATING")?.title ?? null,
    lessons: lessons.map((l) => ({ id: l.id, status: l.status })),
  };
}

/** Lessons + statuses grouped by unit, for the course page. */
export async function getCourseLessons(userId: string, courseId: string) {
  await ownedCourse(userId, courseId);
  return db.unit.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      title: true,
      lessons: {
        orderBy: { order: "asc" },
        select: { id: true, title: true, status: true, skip: true, pageStart: true, pageEnd: true, userEdited: true },
      },
    },
  });
}

/** What the course has cost so far (for the course page; full usage meter comes in Phase 10). */
export async function getCourseCost(userId: string, courseId: string) {
  await ownedCourse(userId, courseId);
  const agg = await db.usageEvent.aggregate({ where: { courseId, userId }, _sum: { costMicroUsd: true } });
  return (agg._sum.costMicroUsd ?? 0) / 1_000_000;
}
