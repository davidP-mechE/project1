import { db } from "../db";
import { enqueueGeneration } from "../queue";
import { recordUsage } from "../usage";
import { ensureAiBudget } from "../limits";
import type { BatchItem, BatchResult, BatchRunner } from "../ai/batch";
import type { StructuredKind } from "../ai/writer";
import type { FlashcardsDraft, LessonDraft } from "@/lib/ai/lesson-schema";
import type { AssessmentDraft } from "@/lib/ai/assessment";
import { parseSettings } from "@/lib/course/settings";
import type { Prisma } from "@/generated/prisma/client";
import {
  applyFlashcards,
  applyLessonDraft,
  finishCourseIfDone,
  loadLesson,
  markLessonFailed,
  prepareLesson,
  type GenerationDeps,
} from "./run";
import {
  applyAssessment,
  markAssessmentFailed,
  prepareAssessment,
} from "./assessments";

/**
 * Whole-course generation through Claude's Message Batches API (half price).
 *
 * 1. `submitLessonBatch` prepares every lesson as usual (re-reading
 *    equation-heavy pages, checking the pages, skipping lessons that are up
 *    to date), then sends all the lesson and flashcard requests as one batch.
 * 2. `pollBatch` checks it until it's done, then saves each result exactly as
 *    a direct request would. Anything that didn't come back usable (declined,
 *    errored, expired) is queued as a normal, direct job, which retries on the
 *    fallback model, so nothing is lost.
 * 3. Units whose lessons are all done then get their unit tests (and finally
 *    the exam) through `submitAssessmentBatch`, the same way.
 */

export type BatchDeps = GenerationDeps & { runner: BatchRunner };

type ItemMeta =
  | { kind: "lesson"; lessonId: string; cacheKey: string; force?: boolean }
  | { kind: "flashcards"; lessonId: string }
  | { kind: "assessment"; assessmentId: string };

const FEATURE = {
  lesson: "LESSON",
  flashcards: "FLASHCARDS",
  assessment: "ASSESSMENT",
  questions: "QUESTIONS",
} as const;
/** Give up waiting on a batch after this long (Claude ends every batch within 24 hours). */
const MAX_BATCH_AGE_MS = 26 * 3600_000;
const DIRECT_PRIORITY = 20; // a lesson that has to be redone directly goes ahead of new course runs

/** Wait before the next check of a batch: the first after `firstPollMs`, then longer, up to 5 minutes. */
export const pollDelayMs = (runner: BatchRunner, attempt: number) =>
  Math.min(5 * 60_000, runner.firstPollMs * 2 ** attempt);

async function submit(
  courseId: string,
  userId: string,
  items: BatchItem[],
  metas: Record<string, ItemMeta>,
  runner: BatchRunner,
) {
  await ensureAiBudget(userId);
  const batchId = await runner.submit(items);
  await db.generationBatch.create({
    data: {
      id: batchId,
      courseId,
      userId,
      items: metas as unknown as Prisma.InputJsonValue,
      requestCount: items.length,
    },
  });
  await enqueueGeneration([
    {
      payload: { kind: "batch-poll", batchId, attempt: 0 },
      priority: 1,
      delayMs: runner.firstPollMs,
    },
  ]);
  return batchId;
}

/** Prepare lessons and send them (and their flashcards) as one batch. Returns the batch id, or null if nothing needed Claude. */
export async function submitLessonBatch(
  payload: { courseId: string; lessonIds: string[]; force?: boolean },
  deps: BatchDeps,
): Promise<string | null> {
  const course = await db.course.findUnique({
    where: { id: payload.courseId },
    select: { userId: true },
  });
  if (!course) return null;
  const items: BatchItem[] = [];
  const metas: Record<string, ItemMeta> = {};
  for (const lessonId of payload.lessonIds) {
    // Lessons stay "queued" while they wait in the batch.
    const prep = await prepareLesson({ lessonId, force: payload.force }, deps, {
      markGenerating: false,
    });
    if ("outcome" in prep) continue; // skipped, flagged or already up to date
    const p = prep.prepared;
    if (p.writeLesson) {
      items.push({
        customId: `lesson-${lessonId}`,
        job: { kind: "lesson", input: p.input },
      });
      metas[`lesson-${lessonId}`] = {
        kind: "lesson",
        lessonId,
        cacheKey: p.cacheKey,
        force: payload.force,
      };
    }
    if (p.writeCards) {
      items.push({
        customId: `cards-${lessonId}`,
        job: { kind: "flashcards", input: p.input },
      });
      metas[`cards-${lessonId}`] = { kind: "flashcards", lessonId };
    }
  }
  if (items.length === 0) {
    await finishCourseIfDone(payload.courseId);
    return null;
  }
  return submit(payload.courseId, course.userId, items, metas, deps.runner);
}

/** Send unit tests / the final exam as one batch. */
export async function submitAssessmentBatch(
  payload: { courseId: string; assessmentIds: string[] },
  deps: BatchDeps,
): Promise<string | null> {
  const course = await db.course.findUnique({
    where: { id: payload.courseId },
    select: { userId: true },
  });
  if (!course) return null;
  const items: BatchItem[] = [];
  const metas: Record<string, ItemMeta> = {};
  for (const assessmentId of payload.assessmentIds) {
    const prep = await prepareAssessment(assessmentId, {
      markGenerating: false,
    });
    if ("outcome" in prep) continue;
    items.push({
      customId: `test-${assessmentId}`,
      job: { kind: "assessment", input: prep.prepared.input },
    });
    metas[`test-${assessmentId}`] = { kind: "assessment", assessmentId };
  }
  if (items.length === 0) return null;
  return submit(payload.courseId, course.userId, items, metas, deps.runner);
}

/** Queue normal, one-at-a-time jobs for requests a batch didn't finish. */
async function redoDirectly(metas: ItemMeta[]) {
  await enqueueGeneration(
    metas.map((m) => ({
      payload:
        m.kind === "lesson"
          ? { kind: "lesson" as const, lessonId: m.lessonId, force: m.force }
          : m.kind === "flashcards"
            ? { kind: "flashcards" as const, lessonId: m.lessonId }
            : { kind: "assessment" as const, assessmentId: m.assessmentId },
      priority: DIRECT_PRIORITY,
    })),
  );
}

/** Save one batch result, exactly as a direct request's would be saved. */
async function applyResult(
  batch: { courseId: string; userId: string },
  meta: ItemMeta,
  r: BatchResult,
): Promise<"saved" | "redo" | "dropped"> {
  const lessonId = meta.kind === "assessment" ? null : meta.lessonId;
  await recordUsage(
    {
      userId: batch.userId,
      courseId: batch.courseId,
      lessonId,
      feature: FEATURE[meta.kind],
    },
    r.calls,
  );

  if (!r.ok) {
    // Too long won't fit on a retry either; everything else (declined, errored, expired, unreadable) is redone directly.
    if (r.error?.kind === "too_long") {
      if (meta.kind === "lesson")
        await markLessonFailed(meta.lessonId, r.error.userMessage);
      if (meta.kind === "assessment")
        await markAssessmentFailed(meta.assessmentId, r.error.userMessage);
      return "dropped";
    }
    if (meta.kind === "flashcards" && r.error && r.error.kind !== "retryable")
      return "dropped"; // the lesson is fine without cards
    console.warn(`[batch] ${meta.kind} will be redone directly: ${r.detail}`);
    return "redo";
  }

  if (meta.kind === "assessment") {
    const prep = await prepareAssessment(meta.assessmentId, {
      markGenerating: false,
    });
    if ("outcome" in prep) return "dropped";
    await applyAssessment(
      prep.prepared,
      r.value as AssessmentDraft,
      r.calls.at(-1)?.model ?? null,
    );
    return "saved";
  }
  const lesson = await loadLesson(meta.lessonId);
  if (!lesson) return "dropped";
  const settings = parseSettings(lesson.course.settings);
  if (meta.kind === "flashcards") {
    await applyFlashcards(lesson, r.value as FlashcardsDraft, settings);
    return "saved";
  }
  // Only fill a lesson that's still waiting for this batch (not one the student regenerated or skipped meanwhile).
  if (!["QUEUED", "GENERATING"].includes(lesson.status)) return "dropped";
  await applyLessonDraft(
    { lesson, settings, cacheKey: meta.cacheKey },
    r.value as LessonDraft,
    r.calls.at(-1)?.model ?? "unknown",
  );
  return "saved";
}

/**
 * Check a batch. "waiting" while Claude is still working on it; once it has
 * ended, every result is saved (or redone directly) and the course moves on.
 */
export async function pollBatch(
  payload: { batchId: string },
  deps: BatchDeps,
): Promise<"waiting" | "processed" | "gone"> {
  const batch = await db.generationBatch.findUnique({
    where: { id: payload.batchId },
  });
  if (!batch) return "gone"; // the course was deleted
  if (batch.status !== "SUBMITTED") return "processed";
  const metas = batch.items as unknown as Record<string, ItemMeta>;

  if (!(await deps.runner.isDone(batch.id))) {
    if (Date.now() - batch.createdAt.getTime() < MAX_BATCH_AGE_MS)
      return "waiting";
    // Far past Claude's 24-hour limit: stop waiting and write what's left one at a time.
    const left = Object.entries(metas)
      .filter(([id]) => !batch.processedIds.includes(id))
      .map(([, m]) => m);
    await redoDirectly(left);
    await db.generationBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", endedAt: new Date() },
    });
    return "processed";
  }

  const done = new Set(batch.processedIds);
  const redo: ItemMeta[] = [];
  const seen = new Set<string>();
  for await (const r of deps.runner.results(
    batch.id,
    (id) => (metas[id]?.kind as StructuredKind | undefined) ?? null,
  )) {
    seen.add(r.customId);
    const meta = metas[r.customId];
    if (!meta || done.has(r.customId)) continue; // saved by an earlier, interrupted check
    if ((await applyResult(batch, meta, r)) === "redo") redo.push(meta);
    // Remember each saved result, so a check that's interrupted and retried never saves (or bills) it twice.
    await db.generationBatch.update({
      where: { id: batch.id },
      data: { processedIds: { push: r.customId } },
    });
  }
  // Anything the batch didn't return at all is redone too.
  for (const [id, meta] of Object.entries(metas))
    if (!seen.has(id) && !done.has(id)) redo.push(meta);
  await redoDirectly(redo);
  // Written lessons that only waited for their flashcards are ready, whatever happened to the cards
  // (lessons being redone directly stay queued until that's done).
  const redoLessons = new Set(
    redo.flatMap((m) => (m.kind === "lesson" ? [m.lessonId] : [])),
  );
  const lessonIds = [
    ...new Set(
      Object.values(metas).flatMap((m) =>
        m.kind === "assessment" ? [] : [m.lessonId],
      ),
    ),
  ].filter((id) => !redoLessons.has(id));
  await db.lesson.updateMany({
    where: {
      id: { in: lessonIds },
      status: "QUEUED",
      generatedAt: { not: null },
    },
    data: { status: "READY" },
  });
  await db.generationBatch.update({
    where: { id: batch.id },
    data: { status: "PROCESSED", endedAt: new Date() },
  });
  await finishCourseIfDone(batch.courseId);
  return "processed";
}

/** A batch job that failed for good: write its lessons / tests one at a time instead. */
export async function batchJobFailed(
  payload:
    | { kind: "lesson-batch"; lessonIds: string[]; force?: boolean }
    | { kind: "assessment-batch"; assessmentIds: string[] },
) {
  await redoDirectly(
    payload.kind === "lesson-batch"
      ? payload.lessonIds.flatMap((lessonId): ItemMeta[] => [
          { kind: "lesson", lessonId, cacheKey: "", force: payload.force },
        ])
      : payload.assessmentIds.map(
          (assessmentId): ItemMeta => ({ kind: "assessment", assessmentId }),
        ),
  );
}

/** For the course page: is part of this course waiting in a batch? */
export async function pendingBatch(courseId: string) {
  return db.generationBatch.findFirst({
    where: { courseId, status: "SUBMITTED" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, requestCount: true },
  });
}
