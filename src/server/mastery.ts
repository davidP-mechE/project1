import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { toView, type AttemptView } from "./study";
import { courseMastery, lessonMastery, pickPracticeSet, type Candidate, type LessonMastery, type QuestionProgress } from "@/lib/mastery/mastery";
import type { PracticeQuestion } from "@/components/study/practice";

/**
 * The Practice tab: mastery per lesson (from practice answers and flashcard
 * memory) and practice sets that target what the student knows least.
 */

async function ownedCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, title: true, bookId: true } });
  if (!course) throw new NotFoundError("Course not found");
  return course;
}

/** Latest score, when and how often, per question (practice and tests both count). */
async function questionProgress(userId: string, questionIds: string[]): Promise<Map<string, QuestionProgress & { latest: AttemptView | null }>> {
  const [latest, counts] = await Promise.all([
    db.questionAttempt.findMany({ where: { userId, questionId: { in: questionIds } }, orderBy: { createdAt: "desc" }, distinct: ["questionId"] }),
    db.questionAttempt.groupBy({ by: ["questionId"], where: { userId, questionId: { in: questionIds } }, _count: { _all: true } }),
  ]);
  const byId = new Map(latest.map((a) => [a.questionId!, a]));
  const countOf = new Map(counts.map((c) => [c.questionId!, c._count._all]));
  return new Map(
    questionIds.map((id) => {
      const a = byId.get(id);
      return [id, { id, latestScore: a ? a.score : null, lastAnsweredAt: a?.createdAt ?? null, attempts: countOf.get(id) ?? 0, latest: a ? toView(a) : null }];
    }),
  );
}

async function lessonsWithPractice(courseId: string, userId: string) {
  return db.lesson.findMany({
    where: { courseId, skip: false, generatedAt: { not: null } },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      unit: { select: { id: true, title: true } },
      questions: { where: { scope: "LESSON" }, orderBy: { order: "asc" }, select: { id: true } },
      flashcards: { select: { states: { where: { userId }, select: { state: true, stability: true } } } },
    },
  });
}

export type MasteryLesson = { id: string; title: string; mastery: LessonMastery };

export async function getCourseMastery(userId: string, courseId: string) {
  await ownedCourse(userId, courseId);
  const lessons = await lessonsWithPractice(courseId, userId);
  const progress = await questionProgress(userId, lessons.flatMap((l) => l.questions.map((q) => q.id)));
  const units: { id: string; title: string; lessons: MasteryLesson[] }[] = [];
  const all: LessonMastery[] = [];
  for (const l of lessons) {
    const mastery = lessonMastery(
      l.questions.map((q) => progress.get(q.id)!),
      l.flashcards.map((f) => f.states[0] ?? { state: "NEW" as const, stability: 0 }),
    );
    all.push(mastery);
    let unit = units[units.length - 1];
    if (!unit || unit.id !== l.unit.id) units.push((unit = { id: l.unit.id, title: l.unit.title, lessons: [] }));
    unit.lessons.push({ id: l.id, title: l.title, mastery });
  }
  return { units, overall: courseMastery(all), questionCount: progress.size };
}

export const PRACTICE_SET_SIZE = 10;

/** A practice set for the whole course, or for one lesson. Includes answers (shown after each try, as on the lesson page). */
export async function getPracticeSet(userId: string, courseId: string, opts: { lessonId?: string | null; size?: number } = {}) {
  const course = await ownedCourse(userId, courseId);
  const lessons = (await lessonsWithPractice(courseId, userId)).filter((l) => !opts.lessonId || l.id === opts.lessonId);
  if (opts.lessonId && lessons.length === 0) throw new NotFoundError("Lesson not found");
  const progress = await questionProgress(userId, lessons.flatMap((l) => l.questions.map((q) => q.id)));
  const candidates: Candidate[] = [];
  for (const l of lessons) {
    const qs = l.questions.map((q) => progress.get(q.id)!);
    const m = lessonMastery(qs, l.flashcards.map((f) => f.states[0] ?? { state: "NEW" as const, stability: 0 }));
    for (const q of qs) candidates.push({ ...q, lessonId: l.id, lessonScore: m.score });
  }
  const ids = pickPracticeSet(candidates, opts.size ?? PRACTICE_SET_SIZE, { perLesson: opts.lessonId ? undefined : 3 });
  const rows = await db.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, type: true, prompt: true, choices: true, correctChoice: true, answer: true, explanation: true, steps: true, pageRefs: true, topic: true, lesson: { select: { id: true, title: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const questions = ids
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => ({
      question: {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        choices: (q.choices as string[] | null) ?? [],
        correctChoice: q.correctChoice,
        answer: q.answer,
        explanation: q.explanation,
        steps: (q.steps as string[] | null) ?? [],
        pageRefs: q.pageRefs,
        topic: q.topic,
      } satisfies PracticeQuestion,
      lesson: q.lesson ? { id: q.lesson.id, title: q.lesson.title } : null,
      last: progress.get(q.id)?.latest ?? null,
    }));
  return { bookId: course.bookId, questions };
}
