import { db } from "../db";
import { recordUsage } from "../usage";
import { AiError, type LessonWriter } from "../ai/writer";
import { parseSettings } from "@/lib/course/settings";
import { PROMPT_VERSION } from "@/lib/ai/prompts";
import { assessSource, lessonCacheKey, needsRepair, type SourcePage } from "@/lib/ai/source";
import { normalizeLessonDraft, normalizeQuestions } from "@/lib/ai/normalize";
import type { StoredFlashcard, StoredQuestion } from "@/lib/ai/lesson-schema";
import type { Prisma } from "@/generated/prisma/client";
import { syncFlashcards } from "../flashcard-store";
import { queueReadyAssessments } from "./assessments";
import { ensureAiBudget } from "../limits";

/**
 * The work done by the background worker for one lesson. Separate from the
 * queue so tests can run it directly with a fake writer.
 */

export type GenerationDeps = {
  writer: LessonWriter;
  model: string;
  effort: string;
  /** Renders a page to PNG (only needed for equation-heavy pages). */
  renderPage?: (bookId: string, pageNumber: number) => Promise<Buffer>;
};

export type JobOutcome = "generated" | "cached" | "flagged" | "skipped" | "gone";

/** Max equation-heavy pages re-read per lesson, to keep cost predictable. */
export const MAX_REPAIRS_PER_LESSON = 15;

async function loadLesson(lessonId: string) {
  return db.lesson.findUnique({
    where: { id: lessonId },
    include: {
      unit: { select: { title: true } },
      course: { select: { id: true, userId: true, title: true, settings: true, bookId: true, status: true, book: { select: { kind: true } } } },
    },
  });
}
type LoadedLesson = NonNullable<Awaited<ReturnType<typeof loadLesson>>>;
const sourceKind = (lesson: LoadedLesson) => (lesson.course.book.kind === "SLIDES" ? ("slides" as const) : ("book" as const));

async function loadPages(lesson: LoadedLesson): Promise<SourcePage[]> {
  return db.page.findMany({
    where: { bookId: lesson.course.bookId, pageNumber: { gte: lesson.pageStart, lte: lesson.pageEnd } },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, label: true, text: true, textSource: true, mathScore: true, repairedText: true, imageCount: true },
  });
}

/** Re-read equation-heavy pages from images (once per page; the result is saved on the page). */
async function repairPages(lesson: LoadedLesson, pages: SourcePage[], deps: GenerationDeps): Promise<SourcePage[]> {
  if (!deps.renderPage) return pages;
  const kind = sourceKind(lesson);
  const todo = pages.filter((p) => needsRepair(p, kind)).slice(0, MAX_REPAIRS_PER_LESSON);
  if (todo.length > 0) await ensureAiBudget(lesson.course.userId);
  for (const p of todo) {
    try {
      const png = await deps.renderPage(lesson.course.bookId, p.pageNumber);
      const res = await deps.writer.repairPage(png, kind);
      await recordUsage({ userId: lesson.course.userId, courseId: lesson.courseId, lessonId: lesson.id, feature: "PAGE_REPAIR" }, res.calls);
      if (res.value.trim().length > 0) {
        await db.page.update({
          where: { bookId_pageNumber: { bookId: lesson.course.bookId, pageNumber: p.pageNumber } },
          data: { repairedText: res.value, repairedAt: new Date() },
        });
        p.repairedText = res.value;
      }
    } catch (err) {
      if (err instanceof AiError) {
        await recordUsage({ userId: lesson.course.userId, courseId: lesson.courseId, lessonId: lesson.id, feature: "PAGE_REPAIR" }, err.calls);
        if (err.kind === "retryable" || err.kind === "config") throw err; // try the whole job again later
      } else {
        console.warn(`[generate] couldn't repair page ${p.pageNumber}:`, err);
      }
      // Otherwise carry on with the extracted text for this page.
    }
  }
  return pages;
}

async function saveQuestions(tx: Prisma.TransactionClient, lesson: LoadedLesson, questions: StoredQuestion[], userEdited = false) {
  await tx.question.deleteMany({ where: { lessonId: lesson.id, scope: "LESSON" } });
  if (questions.length > 0) {
    await tx.question.createMany({
      data: questions.map((q, i) => ({ ...q, courseId: lesson.courseId, lessonId: lesson.id, scope: "LESSON" as const, order: i, userEdited })),
    });
  }
}

/** Keeps cards that ask the same thing, so students' review history survives a regeneration. */
async function saveFlashcards(tx: Prisma.TransactionClient, lesson: LoadedLesson, cards: StoredFlashcard[], userEdited = false) {
  await syncFlashcards(tx, lesson, cards, userEdited);
}

/** When no included lesson is waiting or being written any more, the course is ready to study. */
export async function finishCourseIfDone(courseId: string) {
  const busy = await db.lesson.count({ where: { courseId, skip: false, status: { in: ["QUEUED", "GENERATING"] } } });
  if (busy === 0) await db.course.updateMany({ where: { id: courseId, status: "GENERATING" }, data: { status: "ACTIVE" } });
  // A unit whose lessons are all finished gets its summary and test written next.
  await queueReadyAssessments(courseId);
}

/** Write (or re-write) one lesson. */
export async function runLessonJob(
  payload: { lessonId: string; force?: boolean; allowThin?: boolean },
  deps: GenerationDeps,
): Promise<JobOutcome> {
  const lesson = await loadLesson(payload.lessonId);
  if (!lesson) return "gone";
  const ctx = { userId: lesson.course.userId, courseId: lesson.courseId, lessonId: lesson.id };
  if (lesson.skip && !payload.force) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: lesson.content ? "READY" : "PENDING" } });
    await finishCourseIfDone(lesson.courseId);
    return "skipped";
  }
  const settings = parseSettings(lesson.course.settings);
  await db.lesson.update({ where: { id: lesson.id }, data: { status: "GENERATING", error: null } });

  let pages = await loadPages(lesson);
  pages = await repairPages(lesson, pages, deps);

  const source = assessSource(pages, sourceKind(lesson));
  if (!source.ok && !payload.allowThin) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "FLAGGED", flagReason: source.reason } });
    await finishCourseIfDone(lesson.courseId);
    return "flagged";
  }

  const key = lessonCacheKey({
    promptVersion: PROMPT_VERSION,
    model: deps.model,
    effort: deps.effort,
    settings,
    courseTitle: lesson.course.title,
    unitTitle: lesson.unit.title,
    lessonTitle: lesson.title,
    pages,
  });
  // Nothing changed since it was written (or the student edited it by hand): keep it.
  if (!payload.force && lesson.content && (lesson.cacheKey === key || lesson.userEdited)) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "READY" } });
    await finishCourseIfDone(lesson.courseId);
    return "cached";
  }

  const input = {
    courseTitle: lesson.course.title,
    unitTitle: lesson.unit.title,
    lessonTitle: lesson.title,
    pageStart: lesson.pageStart,
    pageEnd: lesson.pageEnd,
    pages,
    settings,
    sourceKind: sourceKind(lesson),
  };
  await ensureAiBudget(lesson.course.userId);
  let result;
  try {
    result = await deps.writer.writeLesson(input);
  } catch (err) {
    if (err instanceof AiError) await recordUsage({ ...ctx, feature: "LESSON" }, err.calls);
    throw err;
  }
  await recordUsage({ ...ctx, feature: "LESSON" }, result.calls);

  const normalized = normalizeLessonDraft(result.value, lesson, settings);
  if (!normalized.usable) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "FLAGGED", flagReason: normalized.reason, cacheKey: key } });
    await finishCourseIfDone(lesson.courseId);
    return "flagged";
  }

  await db.$transaction(async (tx) => {
    await saveQuestions(tx, lesson, normalized.questions);
    await saveFlashcards(tx, lesson, normalized.flashcards);
    await tx.lesson.update({
      where: { id: lesson.id },
      data: {
        status: "READY",
        content: normalized.content as unknown as Prisma.InputJsonValue,
        cacheKey: key,
        model: result.calls.at(-1)?.model ?? deps.model,
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date(),
        userEdited: false,
        flagReason: null,
        error: null,
      },
    });
  });
  await finishCourseIfDone(lesson.courseId);
  return "generated";
}

/** Replace only the practice questions of a lesson that's already written. */
export async function runQuestionsJob(payload: { lessonId: string }, deps: GenerationDeps): Promise<JobOutcome> {
  const lesson = await loadLesson(payload.lessonId);
  if (!lesson) return "gone";
  if (!lesson.content) return "skipped";
  const settings = parseSettings(lesson.course.settings);
  const pages = await loadPages(lesson);
  const existing = await db.question.findMany({ where: { lessonId: lesson.id, scope: "LESSON" }, select: { prompt: true } });
  const ctx = { userId: lesson.course.userId, courseId: lesson.courseId, lessonId: lesson.id, feature: "QUESTIONS" as const };

  await ensureAiBudget(lesson.course.userId);
  let result;
  try {
    result = await deps.writer.writeQuestions({
      courseTitle: lesson.course.title,
      unitTitle: lesson.unit.title,
      lessonTitle: lesson.title,
      pageStart: lesson.pageStart,
      pageEnd: lesson.pageEnd,
      pages,
      settings,
      sourceKind: sourceKind(lesson),
      avoid: existing.map((q) => q.prompt).slice(0, 30),
    });
  } catch (err) {
    if (err instanceof AiError) await recordUsage(ctx, err.calls);
    throw err;
  }
  await recordUsage(ctx, result.calls);
  const questions = normalizeQuestions(result.value.questions, lesson, settings);
  if (questions.length === 0) {
    throw new AiError("invalid", "Claude didn't return any usable questions. Try again, or add questions by hand.");
  }
  await db.$transaction(async (tx) => {
    await saveQuestions(tx, lesson, questions);
    await tx.lesson.update({ where: { id: lesson.id }, data: { status: "READY", error: null } });
  });
  return "generated";
}

/** Called when a job has failed for good (no more retries). */
export async function markLessonFailed(lessonId: string, message: string) {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true, content: true } });
  if (!lesson) return;
  // A lesson that already had content keeps it (e.g. a failed "regenerate questions").
  await db.lesson.update({
    where: { id: lessonId },
    data: { status: lesson.content ? "READY" : "FAILED", error: message },
  });
  await finishCourseIfDone(lesson.courseId);
}
