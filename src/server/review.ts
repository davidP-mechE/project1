import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { toView, type AttemptView } from "./study";
import { recordUsage } from "./usage";
import { ensureAiBudget } from "./limits";
import { AiError, type LessonWriter } from "./ai/writer";
import { normalizeQuestions } from "@/lib/ai/normalize";
import { parseSettings } from "@/lib/course/settings";
import { isDue, questionSchedule, skillKey, skillStats, type Attempt, type SkillStats } from "@/lib/mastery/review";
import type { PracticeQuestion } from "@/components/study/practice";
import type { SourceKindName } from "@/lib/source-label";

/**
 * The Error log, Review (skill drills) and question spaced repetition. All of
 * it is read from the student's answer history (QuestionAttempt); Review can
 * also ask Claude for more questions on one skill (scope DRILL).
 */

export type ReviewItem = { question: PracticeQuestion; lesson: { id: string; title: string } | null; last: AttemptView | null };

const questionSelect = {
  id: true,
  courseId: true,
  type: true,
  prompt: true,
  choices: true,
  correctChoice: true,
  answer: true,
  explanation: true,
  steps: true,
  pageRefs: true,
  topic: true,
  scope: true,
  lesson: { select: { id: true, title: true, skip: true } },
} as const;

type QuestionRow = {
  id: string;
  type: PracticeQuestion["type"];
  prompt: string;
  choices: string[];
  correctChoice: number | null;
  answer: string;
  explanation: string;
  steps: string[];
  pageRefs: number[];
  topic: string;
  lesson: { id: string; title: string } | null;
};

const toPractice = (q: QuestionRow): PracticeQuestion => ({
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
});

/** The student's courses (not archived), for grouping. */
async function courses(userId: string, courseId?: string | null) {
  const list = await db.course.findMany({
    where: { userId, archivedAt: null, ...(courseId ? { id: courseId } : {}) },
    orderBy: [{ lastOpenedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, title: true, book: { select: { id: true, kind: true } } },
  });
  if (courseId && list.length === 0) throw new NotFoundError("Course not found");
  return list;
}

/** Every answer, oldest first, grouped by question. */
async function attemptsByQuestion(userId: string, courseIds: string[]) {
  const rows = await db.questionAttempt.findMany({
    where: { userId, courseId: { in: courseIds }, questionId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = map.get(r.questionId!) ?? [];
    list.push(r);
    map.set(r.questionId!, list);
  }
  return map;
}

const asAttempt = (a: { correct: boolean; score: number; createdAt: Date }): Attempt => ({ correct: a.correct, score: a.score, at: a.createdAt });

// ─── Error log ──────────────────────────────────────────────────────────────

export type ErrorEntry = {
  questionId: string;
  prompt: string;
  type: PracticeQuestion["type"];
  yourAnswer: string;
  correctAnswer: string;
  explanation: string;
  feedback: string;
  missed: number;
  lastMissedAt: Date;
  fixed: boolean; // answered right since the last miss
  where: string; // "Lesson: Ohm's law", "Unit test", "Final exam", "Review"
  lessonId: string | null;
};

/** Every question the student has missed, by course, then by skill. */
export async function getErrorLog(userId: string, opts: { courseId?: string | null; status?: "open" | "fixed" | "all" } = {}) {
  const list = await courses(userId, opts.courseId);
  const attempts = await attemptsByQuestion(userId, list.map((c) => c.id));
  const missedIds = [...attempts.entries()].filter(([, as]) => as.some((a) => !a.correct)).map(([id]) => id);
  const questions = await db.question.findMany({ where: { id: { in: missedIds } }, select: { ...questionSelect, assessment: { select: { kind: true } } } });

  const status = opts.status ?? "open";
  const byCourse = new Map<string, Map<string, { topic: string; entries: ErrorEntry[] }>>();
  for (const q of questions) {
    const as = attempts.get(q.id)!;
    const misses = as.filter((a) => !a.correct);
    const lastMiss = misses[misses.length - 1];
    const fixed = as[as.length - 1].correct;
    if ((status === "open" && fixed) || (status === "fixed" && !fixed)) continue;
    const yourAnswer = q.type === "MULTIPLE_CHOICE" ? (lastMiss.choice !== null ? (q.choices[lastMiss.choice] ?? "") : "") : lastMiss.response;
    const correctAnswer = q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? (q.choices[q.correctChoice] ?? q.answer) : q.answer;
    const where =
      q.scope === "UNIT_TEST" ? "Unit test" : q.scope === "FINAL_EXAM" ? "Final exam" : q.scope === "DRILL" ? `Review${q.lesson ? `: ${q.lesson.title}` : ""}` : `Lesson: ${q.lesson?.title ?? ""}`;
    const skills = byCourse.get(q.courseId) ?? new Map();
    const key = skillKey(q.topic) || "general";
    const skill = skills.get(key) ?? { topic: q.topic || "General", entries: [] };
    skill.entries.push({
      questionId: q.id,
      prompt: q.prompt,
      type: q.type,
      yourAnswer: yourAnswer.trim() || "(no answer)",
      correctAnswer,
      explanation: q.explanation,
      feedback: lastMiss.feedback,
      missed: misses.length,
      lastMissedAt: lastMiss.createdAt,
      fixed,
      where,
      lessonId: q.lesson?.id ?? null,
    });
    skills.set(key, skill);
    byCourse.set(q.courseId, skills);
  }
  return list
    .filter((c) => byCourse.has(c.id))
    .map((c) => {
      const skills = [...byCourse.get(c.id)!.entries()].map(([key, s]) => ({
        key,
        topic: s.topic,
        open: s.entries.filter((e) => !e.fixed).length,
        entries: s.entries.sort((a, b) => b.lastMissedAt.getTime() - a.lastMissedAt.getTime()),
      }));
      skills.sort((a, b) => b.open - a.open || b.entries.length - a.entries.length || a.topic.localeCompare(b.topic));
      return { id: c.id, title: c.title, kind: c.book.kind as SourceKindName, skills, total: skills.reduce((n, s) => n + s.entries.length, 0) };
    });
}

// ─── Skills (Review) ────────────────────────────────────────────────────────

export type Skill = {
  key: string;
  topic: string;
  questions: number;
  stats: SkillStats;
  lesson: { id: string; title: string } | null; // where most of its questions come from
};

/** Practice questions in courses, as skills (topics) with how the student is doing on each. */
export async function getSkills(userId: string, opts: { courseId?: string | null } = {}) {
  const list = await courses(userId, opts.courseId);
  const ids = list.map((c) => c.id);
  const [questions, attempts] = await Promise.all([
    db.question.findMany({
      where: { courseId: { in: ids }, scope: { in: ["LESSON", "DRILL"] }, OR: [{ lesson: { skip: false } }, { lessonId: null }] },
      select: { id: true, courseId: true, topic: true, lesson: { select: { id: true, title: true } } },
    }),
    attemptsByQuestion(userId, ids),
  ]);
  const byCourse = new Map<string, Map<string, { topic: string; ids: string[]; lessons: Map<string, { id: string; title: string; n: number }> }>>();
  for (const q of questions) {
    const key = skillKey(q.topic);
    if (!key) continue;
    const skills = byCourse.get(q.courseId) ?? new Map();
    const s = skills.get(key) ?? { topic: q.topic, ids: [], lessons: new Map() };
    s.ids.push(q.id);
    if (q.lesson) {
      const l = s.lessons.get(q.lesson.id) ?? { ...q.lesson, n: 0 };
      l.n++;
      s.lessons.set(q.lesson.id, l);
    }
    skills.set(key, s);
    byCourse.set(q.courseId, skills);
  }
  return list
    .filter((c) => byCourse.has(c.id))
    .map((c) => {
      const skills: Skill[] = [...byCourse.get(c.id)!.entries()].map(([key, s]) => {
        const all = s.ids.flatMap((id) => (attempts.get(id) ?? []).map(asAttempt));
        const top = [...s.lessons.values()].sort((a, b) => b.n - a.n)[0];
        return { key, topic: s.topic, questions: s.ids.length, stats: skillStats(all), lesson: top ? { id: top.id, title: top.title } : null };
      });
      // Shakiest first; untried after; hammered last.
      const rank = { shaky: 0, improving: 1, new: 2, hammered: 3 } as const;
      skills.sort((a, b) => rank[a.stats.status] - rank[b.stats.status] || (a.stats.accuracy ?? 1) - (b.stats.accuracy ?? 1) || a.topic.localeCompare(b.topic));
      return { id: c.id, title: c.title, kind: c.book.kind as SourceKindName, skills };
    });
}

/** The questions for one skill in a course, for a Review session: untried and missed first. */
export async function getSkillDrill(userId: string, courseId: string, key: string) {
  const [course] = await courses(userId, courseId);
  const questions = await db.question.findMany({
    where: { courseId, scope: { in: ["LESSON", "DRILL"] }, OR: [{ lesson: { skip: false } }, { lessonId: null }] },
    select: questionSelect,
  });
  const forSkill = questions.filter((q) => skillKey(q.topic) === key);
  if (forSkill.length === 0) throw new NotFoundError("Skill not found");
  const attempts = await attemptsByQuestion(userId, [courseId]);
  const order = (id: string) => {
    const as = attempts.get(id) ?? [];
    if (as.length === 0) return 0;
    return as[as.length - 1].correct ? 2 + as.length / 100 : 1;
  };
  const items: ReviewItem[] = forSkill
    .sort((a, b) => order(a.id) - order(b.id))
    .map((q) => {
      const as = attempts.get(q.id);
      return { question: toPractice(q), lesson: q.lesson ? { id: q.lesson.id, title: q.lesson.title } : null, last: as?.length ? toView(as[as.length - 1]) : null };
    });
  const stats = skillStats(forSkill.flatMap((q) => (attempts.get(q.id) ?? []).map(asAttempt)));
  return { course: { id: course.id, title: course.title, bookId: course.book.id }, topic: forSkill[0].topic, key, items, stats };
}

/** Questions Review writes per request, and the most it keeps per skill (enough to hammer it many times). */
export const DRILL_BATCH = 5;
export const MAX_DRILL_PER_SKILL = 60;

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Ask Claude for more questions on one skill, from the pages of the lesson it comes from. */
export async function generateSkillQuestions(userId: string, courseId: string, key: string, deps: { writer: LessonWriter }): Promise<ReviewItem[]> {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, title: true, settings: true, bookId: true, book: { select: { kind: true } } } });
  if (!course) throw new NotFoundError("Course not found");
  const existing = await db.question.findMany({
    where: { courseId, scope: { in: ["LESSON", "DRILL"] }, lessonId: { not: null } },
    select: { prompt: true, topic: true, scope: true, lessonId: true },
  });
  const forSkill = existing.filter((q) => skillKey(q.topic) === key);
  if (forSkill.length === 0) throw new NotFoundError("Skill not found");
  if (forSkill.filter((q) => q.scope === "DRILL").length >= MAX_DRILL_PER_SKILL) {
    throw new ReviewError("This skill already has plenty of extra questions. Keep practising the ones you have, or try another skill.", 409);
  }
  // The lesson most of this skill's questions come from.
  const counts = new Map<string, number>();
  for (const q of forSkill) counts.set(q.lessonId!, (counts.get(q.lessonId!) ?? 0) + 1);
  const lessonId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const lesson = await db.lesson.findUniqueOrThrow({ where: { id: lessonId }, select: { id: true, title: true, pageStart: true, pageEnd: true, unit: { select: { title: true } } } });
  const pages = await db.page.findMany({
    where: { bookId: course.bookId, pageNumber: { gte: lesson.pageStart, lte: lesson.pageEnd } },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, label: true, text: true, textSource: true, mathScore: true, repairedText: true, imageCount: true },
  });
  const settings = { ...parseSettings(course.settings), questionsPerLesson: DRILL_BATCH };
  const topic = forSkill[0].topic;

  try {
    await ensureAiBudget(userId);
  } catch (err) {
    if (err instanceof AiError) throw new ReviewError(err.userMessage, 429);
    throw err;
  }
  const ctx = { userId, courseId, lessonId: lesson.id, feature: "QUESTIONS" as const };
  let result;
  try {
    result = await deps.writer.writeQuestions({
      courseTitle: course.title,
      unitTitle: lesson.unit.title,
      lessonTitle: lesson.title,
      pageStart: lesson.pageStart,
      pageEnd: lesson.pageEnd,
      pages,
      settings,
      sourceKind: course.book.kind === "SLIDES" ? "slides" : "book",
      focus: topic,
      avoid: forSkill.map((q) => q.prompt).slice(-40),
    });
  } catch (err) {
    if (err instanceof AiError) {
      await recordUsage(ctx, err.calls);
      throw new ReviewError(err.userMessage, err.kind === "retryable" ? 503 : 422);
    }
    throw err;
  }
  await recordUsage(ctx, result.calls);
  const questions = normalizeQuestions(result.value.questions, lesson, settings);
  if (questions.length === 0) throw new ReviewError("Claude couldn't write new questions on this skill from these pages. Try again, or pick another skill.", 422);
  const last = await db.question.aggregate({ where: { lessonId: lesson.id }, _max: { order: true } });
  const created = await db.$transaction(
    // Keep the skill's name exactly, so the new questions join it.
    questions.map((q, i) => db.question.create({ data: { ...q, topic, courseId, lessonId: lesson.id, scope: "DRILL", order: (last._max.order ?? 0) + 1 + i }, select: questionSelect })),
  );
  return created.map((q) => ({ question: toPractice(q), lesson: q.lesson ? { id: q.lesson.id, title: q.lesson.title } : null, last: null }));
}

// ─── Spaced repetition for questions ────────────────────────────────────────

/** Questions answered before that are due again today (misses tomorrow; right answers further out each time). */
export async function getDueQuestions(userId: string, opts: { courseId?: string | null; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const list = await courses(userId, opts.courseId);
  const attempts = await attemptsByQuestion(userId, list.map((c) => c.id));
  const due = [...attempts.entries()]
    .map(([id, as]) => ({ id, schedule: questionSchedule(as.map(asAttempt)), last: as[as.length - 1] }))
    .filter((x) => isDue(x.schedule, now))
    .sort((a, b) => a.schedule.due!.getTime() - b.schedule.due!.getTime());
  const questions = await db.question.findMany({ where: { id: { in: due.map((d) => d.id) } }, select: questionSelect });
  const byId = new Map(questions.filter((q) => !q.lesson?.skip).map((q) => [q.id, q]));
  const perCourse = new Map<string, number>();
  for (const d of due) {
    const q = byId.get(d.id);
    if (q) perCourse.set(q.courseId, (perCourse.get(q.courseId) ?? 0) + 1);
  }
  const items: (ReviewItem & { courseId: string })[] = due
    .filter((d) => byId.has(d.id))
    .slice(0, opts.limit ?? 20)
    .map((d) => {
      const q = byId.get(d.id)!;
      return { courseId: q.courseId, question: toPractice(q), lesson: q.lesson ? { id: q.lesson.id, title: q.lesson.title } : null, last: toView(d.last) };
    });
  return {
    total: [...perCourse.values()].reduce((a, b) => a + b, 0),
    courses: list.filter((c) => perCourse.has(c.id)).map((c) => ({ id: c.id, title: c.title, bookId: c.book.id, due: perCourse.get(c.id)! })),
    items,
  };
}
