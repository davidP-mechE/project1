import "server-only";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { recordUsage } from "./usage";
import { AiError } from "./ai/writer";
import type { Grader } from "./ai/grader";
import { gradeMultipleChoice, normalizeGrade, practiceSummary, type GradeResult } from "@/lib/grading/grade";
import { checkResponse, quickCheck } from "@/lib/grading/normalize";
import { courseProgress, resumeLesson, type ProgressLesson } from "@/lib/progress/progress";
import type { SourcePage } from "@/lib/ai/source";

/**
 * Studying: lesson progress and practice-question attempts.
 * RULE (as everywhere): every function takes the logged-in user's id and only
 * touches that user's courses.
 */

export class StudyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function ownedLesson(userId: string, lessonId: string) {
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, course: { userId } },
    select: { id: true, courseId: true, skip: true },
  });
  if (!lesson) throw new NotFoundError("Lesson not found");
  return lesson;
}

/** Included lessons of a course in course order, with this student's progress. */
async function lessonsWithProgress(userId: string, courseId: string) {
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false, course: { userId } },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      unitId: true,
      title: true,
      status: true,
      pageStart: true,
      pageEnd: true,
      generatedAt: true,
      progress: { where: { userId }, select: { completedAt: true, lastViewedAt: true, confusing: true } },
    },
  });
  return lessons.map((l) => ({
    id: l.id,
    unitId: l.unitId,
    title: l.title,
    status: l.status,
    pageStart: l.pageStart,
    pageEnd: l.pageEnd,
    ready: l.generatedAt !== null, // content is written together with generatedAt
    completedAt: l.progress[0]?.completedAt ?? null,
    lastViewedAt: l.progress[0]?.lastViewedAt ?? null,
    confusing: l.progress[0]?.confusing ?? false,
  }));
}

/** Recompute the cached percentage shown on library cards. Call after anything that changes progress or the outline. */
export async function recomputeCourseProgress(userId: string, courseId: string) {
  const lessons = await lessonsWithProgress(userId, courseId);
  const { pct } = courseProgress(lessons);
  await db.course.updateMany({ where: { id: courseId, userId }, data: { progressPct: pct } });
  return pct;
}

/** The course's units and lessons with progress, for the study sidebar and the course page. */
export async function getStudyOutline(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course not found");
  const [units, lessons] = await Promise.all([
    db.unit.findMany({ where: { courseId }, orderBy: { order: "asc" }, select: { id: true, title: true } }),
    lessonsWithProgress(userId, courseId),
  ]);
  const progress = courseProgress(lessons as ProgressLesson[]);
  return {
    units: units
      .map((u) => ({
        ...u,
        progress: progress.units.get(u.id) ?? { done: 0, total: 0, pct: 0 },
        lessons: lessons
          .filter((l) => l.unitId === u.id)
          .map((l) => ({ id: l.id, title: l.title, status: l.status, ready: l.ready, completed: Boolean(l.completedAt), pageStart: l.pageStart, pageEnd: l.pageEnd })),
      }))
      .filter((u) => u.lessons.length > 0),
    done: progress.done,
    total: progress.total,
    pct: progress.pct,
    resume: resumeLesson(lessons as ProgressLesson[]),
  };
}

/** Remember that the student opened a lesson (for "Continue where you left off"). */
export async function markLessonViewed(userId: string, lessonId: string) {
  const lesson = await ownedLesson(userId, lessonId);
  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, courseId: lesson.courseId },
    update: { lastViewedAt: new Date() },
  });
}

export async function getLessonProgress(userId: string, lessonId: string) {
  const p = await db.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } }, select: { completedAt: true, confusing: true } });
  return { completed: Boolean(p?.completedAt), confusing: p?.confusing ?? false };
}

export async function setLessonCompleted(userId: string, lessonId: string, completed: boolean) {
  const lesson = await ownedLesson(userId, lessonId);
  if (lesson.skip) throw new StudyError("This lesson is skipped in the outline.");
  const completedAt = completed ? new Date() : null;
  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, courseId: lesson.courseId, completedAt },
    update: { completedAt },
  });
  return recomputeCourseProgress(userId, lesson.courseId);
}

export async function setLessonConfusing(userId: string, lessonId: string, confusing: boolean) {
  const lesson = await ownedLesson(userId, lessonId);
  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, courseId: lesson.courseId, confusing },
    update: { confusing },
  });
}

// ─── Practice questions ───────────────────────────────────────────────────

export type AttemptView = {
  verdict: "CORRECT" | "PARTIAL" | "INCORRECT";
  correct: boolean;
  score: number;
  feedback: string;
  gradedBy: "LOCAL" | "CLAUDE" | "DEMO";
  choice: number | null;
  response: string;
  createdAt: string;
};

const toView = (a: {
  verdict: AttemptView["verdict"];
  correct: boolean;
  score: number;
  feedback: string;
  gradedBy: AttemptView["gradedBy"];
  choice: number | null;
  response: string;
  createdAt: Date;
}): AttemptView => ({
  verdict: a.verdict,
  correct: a.correct,
  score: a.score,
  feedback: a.feedback,
  gradedBy: a.gradedBy,
  choice: a.choice,
  response: a.response,
  createdAt: a.createdAt.toISOString(),
});

/** Each question's most recent attempt by this student, plus the lesson's practice score. */
export async function getLatestAttempts(userId: string, lessonId: string) {
  await ownedLesson(userId, lessonId);
  const questions = await db.question.findMany({ where: { lessonId, scope: "LESSON" }, select: { id: true } });
  const attempts = await db.questionAttempt.findMany({
    where: { userId, questionId: { in: questions.map((q) => q.id) } },
    orderBy: { createdAt: "desc" },
    distinct: ["questionId"],
  });
  const latest = new Map(attempts.map((a) => [a.questionId!, toView(a)]));
  return { latest, summary: practiceSummary(questions.map((q) => q.id), latest) };
}

/** Max pages of book text sent to Claude with one answer (keeps grading quick and cheap). */
const MAX_GRADING_PAGES = 6;

/** The pages a question was written from: its cited pages, else the lesson's first pages. */
export function pagesForGrading(q: { pageRefs: number[] }, lesson: { pageStart: number; pageEnd: number }): number[] {
  const inRange = (p: number) => p >= lesson.pageStart && p <= lesson.pageEnd;
  const cited = [...new Set(q.pageRefs.filter(inRange))].sort((a, b) => a - b);
  if (cited.length > 0) return cited.slice(0, MAX_GRADING_PAGES);
  const all: number[] = [];
  for (let p = lesson.pageStart; p <= lesson.pageEnd && all.length < MAX_GRADING_PAGES; p++) all.push(p);
  return all;
}

export type AttemptInput = { choice?: unknown; response?: unknown };
export type AttemptDeps = { grader: Grader | null };

/**
 * Check a student's answer and save the attempt.
 * - Multiple choice: checked here, free.
 * - Written answers: an obviously identical answer is accepted without Claude;
 *   otherwise Claude grades it against the model answer and the book's pages.
 */
export async function submitAttempt(userId: string, questionId: string, input: AttemptInput, deps: AttemptDeps) {
  const q = await db.question.findFirst({
    where: { id: questionId, course: { userId } },
    include: { lesson: { select: { id: true, pageStart: true, pageEnd: true, course: { select: { bookId: true } } } } },
  });
  if (!q) throw new NotFoundError("Question not found");

  let result: GradeResult;
  let gradedBy: AttemptView["gradedBy"] = "LOCAL";
  let model: string | null = null;
  let choice: number | null = null;
  let response = "";

  if (q.type === "MULTIPLE_CHOICE") {
    const r = gradeMultipleChoice(q, input.choice);
    if ("error" in r) throw new StudyError(r.error);
    result = r;
    choice = input.choice as number;
  } else {
    const checked = checkResponse(input.response);
    if (!checked.ok) throw new StudyError(checked.error);
    response = checked.text;
    if (quickCheck(q.answer, response) === "correct") {
      result = { verdict: "CORRECT", correct: true, score: 1, feedback: "Correct! That matches the model answer." };
    } else {
      if (!deps.grader) {
        throw new StudyError("Answer checking isn't set up on this server (no Claude API key). Compare your answer with the model answer.", 503);
      }
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await db.questionAttempt.count({ where: { userId, gradedBy: "CLAUDE", createdAt: { gte: since } } });
      if (recent >= env.GRADING_PER_HOUR) {
        throw new StudyError(`You've had ${env.GRADING_PER_HOUR} answers checked in the last hour, the hourly limit. Please try again a bit later.`, 429);
      }
      const bookId = q.lesson?.course.bookId;
      const pageNumbers = q.lesson ? pagesForGrading(q, q.lesson) : [];
      const pages: SourcePage[] = bookId
        ? await db.page.findMany({
            where: { bookId, pageNumber: { in: pageNumbers } },
            orderBy: { pageNumber: "asc" },
            select: { pageNumber: true, label: true, text: true, textSource: true, mathScore: true, repairedText: true },
          })
        : [];
      try {
        const graded = await deps.grader.grade({
          type: q.type,
          prompt: q.prompt,
          answer: q.answer,
          explanation: q.explanation,
          steps: q.steps,
          response,
          pages,
        });
        await recordUsage({ userId, courseId: q.courseId, lessonId: q.lessonId, feature: "GRADING" }, graded.calls);
        result = normalizeGrade(graded.value);
        gradedBy = deps.grader.kind === "demo" ? "DEMO" : "CLAUDE";
        model = graded.calls.at(-1)?.model ?? null;
      } catch (err) {
        if (err instanceof AiError) {
          await recordUsage({ userId, courseId: q.courseId, lessonId: q.lessonId, feature: "GRADING" }, err.calls);
          if (err.kind !== "retryable") console.error("Grading failed:", err.message);
          throw new StudyError(err.userMessage, err.kind === "retryable" ? 503 : 502);
        }
        throw err;
      }
    }
  }

  const attempt = await db.questionAttempt.create({
    data: {
      userId,
      courseId: q.courseId,
      lessonId: q.lessonId,
      questionId: q.id,
      topic: q.topic,
      choice,
      response,
      verdict: result.verdict,
      correct: result.correct,
      score: result.score,
      feedback: result.feedback,
      gradedBy,
      model,
    },
  });
  return toView(attempt);
}
