import "server-only";
import { isNoAi } from "./program-access";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { bumpActivity } from "./activity";
import { claudeGradesLastHour, gradeAnswer, studyBudget, gradeQuestionSelect, needsClaude, StudyError, type AttemptDeps, type AttemptInput, type Graded } from "./study";

/**
 * Taking unit tests and the final exam. While taking a test the browser only
 * gets the questions, never the answers; answers come back with the results.
 */

export const MAX_PARALLEL_GRADING = 4;

async function ownedAssessment(userId: string, assessmentId: string) {
  const a = await db.assessment.findFirst({
    where: { id: assessmentId, course: { userId } },
    select: { id: true, kind: true, status: true, courseId: true, unitId: true, summary: true, error: true, unit: { select: { title: true } } },
  });
  if (!a) throw new NotFoundError("Test not found");
  return a;
}

export async function getUnitView(userId: string, courseId: string, unitId: string) {
  const unit = await db.unit.findFirst({
    where: { id: unitId, courseId, course: { userId } },
    select: {
      id: true,
      title: true,
      lessons: { where: { skip: false }, orderBy: { order: "asc" }, select: { id: true, title: true, status: true, pageStart: true, pageEnd: true, progress: { where: { userId }, select: { completedAt: true } } } },
      assessments: { select: { id: true, status: true, summary: true, error: true, _count: { select: { questions: true } } } },
    },
  });
  if (!unit) throw new NotFoundError("Unit not found");
  const a = unit.assessments[0] ?? null;
  const attempts = a ? await attemptHistory(userId, a.id) : [];
  return {
    unit: { id: unit.id, title: unit.title },
    lessons: unit.lessons.map((l) => ({ id: l.id, title: l.title, status: l.status, pageStart: l.pageStart, pageEnd: l.pageEnd, completed: Boolean(l.progress[0]?.completedAt) })),
    assessment: a ? { id: a.id, status: a.status, summary: a.summary, error: a.error, questionCount: a._count.questions } : null,
    attempts,
  };
}

export async function getFinalExamView(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true } });
  if (!course) throw new NotFoundError("Course not found");
  const a = await db.assessment.findFirst({ where: { courseId, kind: "FINAL_EXAM" }, select: { id: true, status: true, error: true, _count: { select: { questions: true } } } });
  return { assessment: a ? { id: a.id, status: a.status, error: a.error, questionCount: a._count.questions } : null, attempts: a ? await attemptHistory(userId, a.id) : [] };
}

async function attemptHistory(userId: string, assessmentId: string) {
  return db.assessmentAttempt.findMany({ where: { userId, assessmentId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, score: true, correct: true, total: true, createdAt: true } });
}

/** Unit tests and final exam of a course, with the student's best score, for the course page. */
export async function getCourseAssessments(userId: string, courseId: string) {
  const list = await db.assessment.findMany({
    where: { courseId, course: { userId } },
    select: { id: true, kind: true, unitId: true, status: true, _count: { select: { questions: true } }, attempts: { where: { userId }, orderBy: { score: "desc" }, take: 1, select: { score: true } } },
  });
  return list.map((a) => ({ id: a.id, kind: a.kind, unitId: a.unitId, status: a.status, questionCount: a._count.questions, best: a.attempts[0]?.score ?? null }));
}

/** The questions to show while taking a test: no answers, no explanations. */
export async function getTestQuestions(userId: string, assessmentId: string) {
  const a = await ownedAssessment(userId, assessmentId);
  if (a.status !== "READY") throw new StudyError("This test isn't ready yet.", 409);
  const questions = await db.question.findMany({
    where: { assessmentId },
    orderBy: { order: "asc" },
    select: { id: true, type: true, prompt: true, choices: true, topic: true },
  });
  return { assessment: a, questions };
}

export type TestResult = {
  attemptId: string;
  score: number;
  correct: number;
  total: number;
  questions: {
    id: string;
    type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP";
    prompt: string;
    choices: string[];
    correctChoice: number | null;
    answer: string;
    explanation: string;
    steps: string[];
    pageRefs: number[];
    topic: string;
    yourChoice: number | null;
    yourResponse: string;
    verdict: "CORRECT" | "PARTIAL" | "INCORRECT";
    score: number;
    feedback: string;
    gradedBy: "LOCAL" | "CLAUDE" | "DEMO";
  }[];
};

/**
 * Grade a whole test. Multiple choice and obvious matches are free; other
 * written answers go to Claude, a few at a time. Unanswered questions count as
 * wrong. If any answer can't be checked (e.g. Claude is busy), nothing is saved
 * and the student can submit again (their answers stay in the browser).
 */
export async function submitTest(userId: string, assessmentId: string, answers: Record<string, AttemptInput>, deps: AttemptDeps): Promise<TestResult> {
  const a = await ownedAssessment(userId, assessmentId);
  if (a.status !== "READY") throw new StudyError("This test isn't ready yet.", 409);
  const questions = await db.question.findMany({ where: { assessmentId }, orderBy: { order: "asc" }, select: gradeQuestionSelect });
  if (questions.length === 0) throw new StudyError("This test has no questions.", 409);
  const input = (id: string): AttemptInput => (answers && typeof answers === "object" && answers[id] && typeof answers[id] === "object" ? answers[id] : {});
  const answered = (q: (typeof questions)[number]) => (q.type === "MULTIPLE_CHOICE" ? typeof input(q.id).choice === "number" : typeof input(q.id).response === "string" && String(input(q.id).response).trim() !== "");

  // "SAT only, no AI" accounts: written answers are saved as not checked (gradeAnswer), never sent to Claude.
  const noAi = await isNoAi(userId);
  const claudeNeeded = noAi ? 0 : questions.filter((q) => answered(q) && needsClaude(q, input(q.id))).length;
  if (claudeNeeded > 0) {
    if (!deps.grader) throw new StudyError("Written answers can't be checked on this server (no Claude API key).", 503);
    if ((await claudeGradesLastHour(userId)) + claudeNeeded > env.GRADING_PER_HOUR) {
      throw new StudyError(`Checking this test needs ${claudeNeeded} written answers graded, which would go over the hourly limit of ${env.GRADING_PER_HOUR}. Please try again a bit later.`, 429);
    }
    await studyBudget(userId);
  }

  const graded = new Map<string, Graded>();
  const queue = questions.filter(answered);
  const workers = Array.from({ length: Math.min(MAX_PARALLEL_GRADING, queue.length) }, async () => {
    for (let q = queue.shift(); q; q = queue.shift()) graded.set(q.id, await gradeAnswer(userId, q, input(q.id), deps, { skipLimit: true, recordUnchecked: noAi }));
  });
  await Promise.all(workers);

  const rows = questions.map((q) => {
    const g = graded.get(q.id);
    return {
      q,
      g: g ?? { result: { verdict: "INCORRECT" as const, correct: false, score: 0, feedback: "Not answered." }, gradedBy: "LOCAL" as const, model: null, choice: null, response: "" },
    };
  });
  const score = rows.reduce((s, r) => s + r.g.result.score, 0) / rows.length;
  const correct = rows.filter((r) => r.g.result.correct).length;
  const attempt = await db.$transaction(async (tx) => {
    const at = await tx.assessmentAttempt.create({ data: { userId, courseId: a.courseId, assessmentId, score, correct, total: rows.length } });
    await tx.questionAttempt.createMany({
      data: rows.map(({ q, g }) => ({
        userId,
        courseId: q.courseId,
        lessonId: q.lessonId,
        questionId: q.id,
        topic: q.topic,
        choice: g.choice,
        response: g.response,
        verdict: g.result.verdict,
        correct: g.result.correct,
        score: g.result.score,
        feedback: g.result.feedback,
        gradedBy: g.gradedBy,
        model: g.model,
        assessmentAttemptId: at.id,
      })),
    });
    return at;
  });
  await bumpActivity(userId, { questionsAnswered: graded.size, questionsCorrect: correct });
  return {
    attemptId: attempt.id,
    score,
    correct,
    total: rows.length,
    questions: rows.map(({ q, g }) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      choices: q.choices,
      correctChoice: q.correctChoice,
      answer: q.answer,
      explanation: q.explanation,
      steps: q.steps,
      pageRefs: q.pageRefs,
      topic: q.topic,
      yourChoice: g.choice,
      yourResponse: g.response,
      verdict: g.result.verdict,
      score: g.result.score,
      feedback: g.result.feedback,
      gradedBy: g.gradedBy,
    })),
  };
}
