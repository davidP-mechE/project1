import { db } from "../db";
import { recordUsage } from "../usage";
import { AiError, type LessonWriter } from "../ai/writer";
import { has, parseSettings, type CourseSettings } from "@/lib/course/settings";
import { PROMPT_VERSION } from "@/lib/ai/prompts";
import { assessSource, lessonCacheKey, needsRepair, type SourcePage } from "@/lib/ai/source";
import { normalizeFlashcards, normalizeLessonDraft, normalizeQuestions } from "@/lib/ai/normalize";
import type { FlashcardsDraft, LessonDraft, StoredQuestion } from "@/lib/ai/lesson-schema";
import type { LessonPromptInput } from "@/lib/ai/prompts";
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

export async function loadLesson(lessonId: string) {
  return db.lesson.findUnique({
    where: { id: lessonId },
    include: {
      unit: { select: { title: true } },
      course: { select: { id: true, userId: true, title: true, settings: true, bookId: true, status: true, book: { select: { kind: true } } } },
    },
  });
}
export type LoadedLesson = NonNullable<Awaited<ReturnType<typeof loadLesson>>>;
const sourceKind = (lesson: LoadedLesson) => (lesson.course.book.kind === "SLIDES" ? ("slides" as const) : ("book" as const));

async function loadPages(lesson: LoadedLesson): Promise<SourcePage[]> {
  return db.page.findMany({
    where: { bookId: lesson.course.bookId, pageNumber: { gte: lesson.pageStart, lte: lesson.pageEnd } },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, label: true, text: true, textSource: true, mathScore: true, repairedText: true, repairModel: true, imageCount: true },
  });
}

/**
 * Re-read equation-heavy pages from images (once per page; the result is saved
 * on the page). A High quality course re-reads pages the small model read
 * before, with the main model.
 */
async function repairPages(lesson: LoadedLesson, pages: SourcePage[], deps: GenerationDeps): Promise<SourcePage[]> {
  if (!deps.renderPage) return pages;
  const kind = sourceKind(lesson);
  const quality = parseSettings(lesson.course.settings).quality;
  const upgrade = (p: SourcePage) => quality === "high" && Boolean(p.repairModel) && p.repairModel !== deps.model && needsRepair({ ...p, repairedText: null }, kind);
  const todo = pages.filter((p) => needsRepair(p, kind) || upgrade(p)).slice(0, MAX_REPAIRS_PER_LESSON);
  if (todo.length > 0) await ensureAiBudget(lesson.course.userId);
  for (const p of todo) {
    try {
      const png = await deps.renderPage(lesson.course.bookId, p.pageNumber);
      const res = await deps.writer.repairPage(png, kind, quality);
      await recordUsage({ userId: lesson.course.userId, courseId: lesson.courseId, lessonId: lesson.id, feature: "PAGE_REPAIR" }, res.calls);
      if (res.value.trim().length > 0) {
        await db.page.update({
          where: { bookId_pageNumber: { bookId: lesson.course.bookId, pageNumber: p.pageNumber } },
          data: { repairedText: res.value, repairedAt: new Date(), repairModel: res.calls.at(-1)?.model ?? null },
        });
        p.repairedText = res.value;
        p.repairModel = res.calls.at(-1)?.model ?? null;
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

/** When no included lesson is waiting or being written any more, the course is ready to study. */
export async function finishCourseIfDone(courseId: string) {
  const busy = await db.lesson.count({ where: { courseId, skip: false, status: { in: ["QUEUED", "GENERATING"] } } });
  if (busy === 0) await db.course.updateMany({ where: { id: courseId, status: "GENERATING" }, data: { status: "ACTIVE" } });
  // A unit whose lessons are all finished gets its summary and test written next.
  await queueReadyAssessments(courseId);
}

const lessonInput = (lesson: LoadedLesson, pages: SourcePage[], settings: CourseSettings): LessonPromptInput => ({
  courseTitle: lesson.course.title,
  unitTitle: lesson.unit.title,
  lessonTitle: lesson.title,
  pageStart: lesson.pageStart,
  pageEnd: lesson.pageEnd,
  pages,
  settings,
  sourceKind: sourceKind(lesson),
});

/** A lesson that needs Claude: what to send, and whether the lesson and/or its flashcards are wanted. */
export type PreparedLesson = {
  lesson: LoadedLesson;
  settings: CourseSettings;
  input: LessonPromptInput;
  cacheKey: string;
  writeLesson: boolean;
  writeCards: boolean;
};

/**
 * Everything before calling Claude for a lesson: skip it, re-read
 * equation-heavy pages, check the pages are usable, and see whether the
 * stored lesson is still up to date. Returns the finished outcome when no
 * request is needed, or what to send.
 */
export async function prepareLesson(
  payload: { lessonId: string; force?: boolean; allowThin?: boolean },
  deps: GenerationDeps,
  opts: { markGenerating?: boolean } = {},
): Promise<{ outcome: JobOutcome } | { prepared: PreparedLesson }> {
  const lesson = await loadLesson(payload.lessonId);
  if (!lesson) return { outcome: "gone" };
  if (lesson.skip && !payload.force) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: lesson.content ? "READY" : "PENDING" } });
    await finishCourseIfDone(lesson.courseId);
    return { outcome: "skipped" };
  }
  const settings = parseSettings(lesson.course.settings);
  if (opts.markGenerating !== false) await db.lesson.update({ where: { id: lesson.id }, data: { status: "GENERATING", error: null } });

  let pages = await loadPages(lesson);
  pages = await repairPages(lesson, pages, deps);

  const source = assessSource(pages, sourceKind(lesson));
  if (!source.ok && !payload.allowThin) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "FLAGGED", flagReason: source.reason } });
    await finishCourseIfDone(lesson.courseId);
    return { outcome: "flagged" };
  }

  const cacheKey = lessonCacheKey({
    promptVersion: PROMPT_VERSION,
    model: deps.model,
    effort: deps.effort,
    settings,
    courseTitle: lesson.course.title,
    unitTitle: lesson.unit.title,
    lessonTitle: lesson.title,
    pages,
  });
  const wantsCards = has(settings, "flashcards") && settings.flashcardsPerLesson > 0;
  // Nothing changed since it was written (or the student edited it by hand): keep it.
  const upToDate = !payload.force && Boolean(lesson.content) && (lesson.cacheKey === cacheKey || lesson.userEdited);
  // Flashcards are their own request, so a lesson can be written while its cards still aren't (e.g. Claude was busy).
  const writeCards = wantsCards && (!upToDate || (await db.flashcard.count({ where: { lessonId: lesson.id } })) === 0);
  if (upToDate && !writeCards) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "READY" } });
    await finishCourseIfDone(lesson.courseId);
    return { outcome: "cached" };
  }
  return { prepared: { lesson, settings, input: lessonInput(lesson, pages, settings), cacheKey, writeLesson: !upToDate, writeCards } };
}

/** Save a written lesson and its practice questions. "flagged" if Claude said the pages can't be taught from. */
export async function applyLessonDraft(p: Pick<PreparedLesson, "lesson" | "settings" | "cacheKey">, draft: LessonDraft, model: string): Promise<"generated" | "flagged"> {
  const { lesson } = p;
  const normalized = normalizeLessonDraft(draft, lesson, p.settings);
  if (!normalized.usable) {
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "FLAGGED", flagReason: normalized.reason, cacheKey: p.cacheKey } });
    return "flagged";
  }
  await db.$transaction(async (tx) => {
    await saveQuestions(tx, lesson, normalized.questions);
    await tx.lesson.update({
      where: { id: lesson.id },
      data: {
        status: "READY",
        content: normalized.content as unknown as Prisma.InputJsonValue,
        cacheKey: p.cacheKey,
        model,
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date(),
        userEdited: false,
        flagReason: null,
        error: null,
      },
    });
  });
  return "generated";
}

/** Save a lesson's flashcards. Cards that ask the same thing keep their review history. */
export async function applyFlashcards(lesson: { id: string; courseId: string; pageStart: number; pageEnd: number }, draft: FlashcardsDraft, settings: CourseSettings) {
  const cards = normalizeFlashcards(draft.flashcards, lesson, settings);
  await db.$transaction(async (tx) => {
    // No usable cards back: keep any the lesson already has (and their review history).
    if (cards.length > 0) await syncFlashcards(tx, lesson, cards, false);
    // Written lessons stay READY; a lesson still being written is left as it is.
    await tx.lesson.updateMany({ where: { id: lesson.id, generatedAt: { not: null } }, data: { status: "READY" } });
  });
  return cards.length;
}

/** Write a lesson's flashcards now. Errors worth retrying are thrown; others leave the lesson without cards. */
async function writeCardsNow(p: PreparedLesson, deps: GenerationDeps) {
  const ctx = { userId: p.lesson.course.userId, courseId: p.lesson.courseId, lessonId: p.lesson.id, feature: "FLASHCARDS" as const };
  try {
    const res = await deps.writer.writeFlashcards(p.input);
    await recordUsage(ctx, res.calls);
    await applyFlashcards(p.lesson, res.value, p.settings);
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    await recordUsage(ctx, err.calls);
    if (err.kind === "retryable" || err.kind === "config") throw err; // the job is retried; the lesson itself is kept
    console.warn(`[generate] no flashcards for lesson ${p.lesson.id}: ${err.message}`);
  }
}

/** Write (or re-write) one lesson, then its flashcards. */
export async function runLessonJob(
  payload: { lessonId: string; force?: boolean; allowThin?: boolean },
  deps: GenerationDeps,
): Promise<JobOutcome> {
  const prep = await prepareLesson(payload, deps);
  if ("outcome" in prep) return prep.outcome;
  const p = prep.prepared;
  const ctx = { userId: p.lesson.course.userId, courseId: p.lesson.courseId, lessonId: p.lesson.id };

  await ensureAiBudget(p.lesson.course.userId);
  if (p.writeLesson) {
    let result;
    try {
      result = await deps.writer.writeLesson(p.input);
    } catch (err) {
      if (err instanceof AiError) await recordUsage({ ...ctx, feature: "LESSON" }, err.calls);
      throw err;
    }
    await recordUsage({ ...ctx, feature: "LESSON" }, result.calls);
    if ((await applyLessonDraft(p, result.value, result.calls.at(-1)?.model ?? deps.model)) === "flagged") {
      await finishCourseIfDone(p.lesson.courseId);
      return "flagged";
    }
  }
  if (p.writeCards) await writeCardsNow(p, deps);
  if (!p.writeLesson) await db.lesson.update({ where: { id: p.lesson.id }, data: { status: "READY" } });
  await finishCourseIfDone(p.lesson.courseId);
  return p.writeLesson ? "generated" : "cached";
}

/** (Re)write only a lesson's flashcards, e.g. when they didn't come back from a batch. */
export async function runFlashcardsJob(payload: { lessonId: string }, deps: GenerationDeps): Promise<JobOutcome> {
  const lesson = await loadLesson(payload.lessonId);
  if (!lesson) return "gone";
  if (!lesson.content) return "skipped";
  const settings = parseSettings(lesson.course.settings);
  if (!has(settings, "flashcards") || settings.flashcardsPerLesson === 0) return "skipped";
  const pages = await loadPages(lesson);
  await ensureAiBudget(lesson.course.userId);
  await writeCardsNow({ lesson, settings, input: lessonInput(lesson, pages, settings), cacheKey: lesson.cacheKey ?? "", writeLesson: false, writeCards: true }, deps);
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
