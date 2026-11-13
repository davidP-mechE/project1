import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { NotFoundError } from "../courses";
import { enqueueGeneration } from "../queue";
import { recordUsage } from "../usage";
import { AiError, type LessonWriter } from "../ai/writer";
import { assertAiAllowed, assertAiBudget, ensureAiBudget } from "../limits";
import { has, parseSettings, type CourseSettings } from "@/lib/course/settings";
import { LessonContentSchema } from "@/lib/ai/lesson-schema";
import { normalizeAssessment, questionCountFor, type AssessmentDraft, type AssessmentLesson, type AssessmentPromptInput } from "@/lib/ai/assessment";
import { env } from "../env";

/**
 * Unit tests (with unit summaries) and the final exam. A unit's test is
 * queued once all its included lessons are finished; the final exam once
 * every unit's test is ready. Lessons that changed later don't rewrite them
 * automatically: the student can regenerate from the unit page.
 */

const ASSESSMENT_PRIORITY = 5_000; // after the lessons still waiting

const isFinished = (s: string) => s === "READY" || s === "FLAGGED" || s === "FAILED";

/**
 * Queue every unit test / final exam that's now possible and doesn't exist yet.
 * They're written in the background, so by default they go out as one batch
 * (half price); `batch: false` when the student is waiting for them.
 */
export async function queueReadyAssessments(courseId: string, opts: { batch?: boolean } = {}) {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { settings: true } });
  if (!course) return 0;
  const settings = parseSettings(course.settings);
  const wantUnit = has(settings, "unitTests") || has(settings, "unitSummaries");
  const wantFinal = has(settings, "finalExam");
  const units = await db.unit.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: { id: true, lessons: { where: { skip: false }, select: { status: true, generatedAt: true } }, assessments: { select: { id: true, status: true } } },
  });
  const active = units.filter((u) => u.lessons.length > 0);
  const jobs: { payload: { kind: "assessment"; assessmentId: string }; priority: number }[] = [];

  if (wantUnit) {
    for (const [i, u] of active.entries()) {
      if (u.assessments.length > 0) continue;
      if (!u.lessons.every((l) => isFinished(l.status)) || !u.lessons.some((l) => l.generatedAt)) continue;
      const a = await db.assessment.create({ data: { courseId, unitId: u.id, kind: "UNIT_TEST" } });
      jobs.push({ payload: { kind: "assessment", assessmentId: a.id }, priority: ASSESSMENT_PRIORITY + i });
    }
  }
  if (wantFinal) {
    const final = await db.assessment.findFirst({ where: { courseId, kind: "FINAL_EXAM" }, select: { id: true } });
    const allLessonsDone = active.every((u) => u.lessons.every((l) => isFinished(l.status)));
    const unitsDone = !wantUnit || (await db.assessment.count({ where: { courseId, kind: "UNIT_TEST", status: { in: ["QUEUED", "GENERATING"] } } })) === 0;
    const anyWritten = active.some((u) => u.lessons.some((l) => l.generatedAt));
    if (!final && allLessonsDone && unitsDone && jobs.length === 0 && anyWritten && active.length > 0) {
      const a = await db.assessment.create({ data: { courseId, kind: "FINAL_EXAM" } });
      jobs.push({ payload: { kind: "assessment", assessmentId: a.id }, priority: ASSESSMENT_PRIORITY + 1_000 });
    }
  }
  const batch = (opts.batch ?? env.CLAUDE_BATCH_GENERATION) && jobs.length > 0;
  if (batch) {
    await enqueueGeneration([{ payload: { kind: "assessment-batch", courseId, assessmentIds: jobs.map((j) => j.payload.assessmentId) }, priority: ASSESSMENT_PRIORITY }]);
  } else {
    await enqueueGeneration(jobs);
  }
  return jobs.length;
}

/** A unit test / final exam that needs Claude: what to send, and what's needed to save the reply. */
export type PreparedAssessment = {
  a: { id: string; kind: "UNIT_TEST" | "FINAL_EXAM"; courseId: string; userId: string };
  settings: CourseSettings;
  input: AssessmentPromptInput;
  wantsQuestions: boolean;
  questionCount: number;
  range: { pageStart: number; pageEnd: number };
};

/** Everything before calling Claude for a unit test / final exam. */
export async function prepareAssessment(
  assessmentId: string,
  opts: { markGenerating?: boolean } = {},
): Promise<{ outcome: "gone" | "failed" } | { prepared: PreparedAssessment }> {
  const a = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: { course: { select: { id: true, title: true, userId: true, settings: true } }, unit: { select: { title: true } } },
  });
  if (!a) return { outcome: "gone" };
  const settings = parseSettings(a.course.settings);
  const lessons = await db.lesson.findMany({
    where: { courseId: a.courseId, skip: false, generatedAt: { not: null }, ...(a.unitId ? { unitId: a.unitId } : {}) },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, title: true, pageStart: true, pageEnd: true, content: true, questions: { where: { scope: "LESSON" }, select: { prompt: true } } },
  });
  const usable: AssessmentLesson[] = [];
  for (const l of lessons) {
    const parsed = LessonContentSchema.safeParse(l.content);
    if (parsed.success) usable.push({ title: l.title, pageStart: l.pageStart, pageEnd: l.pageEnd, content: parsed.data });
  }
  if (usable.length === 0) {
    await markAssessmentFailed(a.id, "There are no written lessons to make this from yet.");
    return { outcome: "failed" };
  }
  if (opts.markGenerating !== false) await db.assessment.update({ where: { id: a.id }, data: { status: "GENERATING", error: null } });
  const wantsQuestions = a.kind === "FINAL_EXAM" || has(settings, "unitTests");
  const questionCount = wantsQuestions ? questionCountFor(a.kind, usable.length) : 0;
  return {
    prepared: {
      a: { id: a.id, kind: a.kind, courseId: a.courseId, userId: a.course.userId },
      settings,
      wantsQuestions,
      questionCount,
      range: { pageStart: Math.min(...usable.map((l) => l.pageStart)), pageEnd: Math.max(...usable.map((l) => l.pageEnd)) },
      input: {
        kind: a.kind,
        courseTitle: a.course.title,
        unitTitle: a.unit?.title ?? null,
        lessons: usable,
        questionCount,
        settings,
        avoid: lessons.flatMap((l) => l.questions.map((q) => q.prompt)),
      },
    },
  };
}

/** Save a written unit test / final exam. */
export async function applyAssessment(p: PreparedAssessment, draft: AssessmentDraft, model: string | null): Promise<"generated" | "failed"> {
  const { a, settings } = p;
  const n = normalizeAssessment(draft, { kind: a.kind, range: p.range, settings, questionCount: p.questionCount });
  if (p.wantsQuestions && n.questions.length === 0) {
    await markAssessmentFailed(a.id, "Claude's questions couldn't be used. Try regenerating.");
    return "failed";
  }
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.question.deleteMany({ where: { assessmentId: a.id } });
    await tx.question.createMany({
      data: n.questions.map((q, i) => ({ ...q, courseId: a.courseId, assessmentId: a.id, scope: a.kind, order: i })),
    });
    await tx.assessment.update({
      where: { id: a.id },
      data: {
        status: "READY",
        summary: has(settings, "unitSummaries") ? n.summary || null : null,
        model,
        generatedAt: new Date(),
        error: null,
      },
    });
  });
  if (a.kind === "UNIT_TEST") await queueReadyAssessments(a.courseId); // the final exam may be next
  return "generated";
}

export async function runAssessmentJob(payload: { assessmentId: string }, deps: { writer: LessonWriter }) {
  const prep = await prepareAssessment(payload.assessmentId);
  if ("outcome" in prep) return prep.outcome;
  const p = prep.prepared;
  await ensureAiBudget(p.a.userId);
  const ctx = { userId: p.a.userId, courseId: p.a.courseId, feature: "ASSESSMENT" as const };
  let result;
  try {
    result = await deps.writer.writeAssessment(p.input);
  } catch (err) {
    if (err instanceof AiError) await recordUsage(ctx, err.calls);
    throw err;
  }
  await recordUsage(ctx, result.calls);
  return applyAssessment(p, result.value, result.calls.at(-1)?.model ?? null);
}

export async function markAssessmentFailed(assessmentId: string, message: string) {
  await db.assessment.updateMany({ where: { id: assessmentId }, data: { status: "FAILED", error: message } });
}

/** The student asked to (re)write a unit test or the final exam. */
export async function regenerateAssessment(userId: string, assessmentId: string) {
  const a = await db.assessment.findFirst({ where: { id: assessmentId, course: { userId } }, select: { id: true, status: true } });
  if (!a) throw new NotFoundError("Not found");
  if (a.status === "QUEUED" || a.status === "GENERATING") return;
  await assertAiBudget(userId);
  await db.assessment.update({ where: { id: a.id }, data: { status: "QUEUED", error: null } });
  await enqueueGeneration([{ payload: { kind: "assessment", assessmentId: a.id }, priority: 1 }]);
}

/** For courses written before unit tests existed: create whatever is possible now. */
export async function createMissingAssessments(userId: string, courseId: string) {
  await assertAiAllowed(userId);
  const c = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true } });
  if (!c) throw new NotFoundError("Course not found");
  return queueReadyAssessments(courseId, { batch: false }); // the student asked: write them now
}
