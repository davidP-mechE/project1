import { courseAccessWhere, programAccess } from "./program-access";
import "server-only";
import { db } from "./db";
import { getReviewCounts } from "./srs";
import { getStudyOutline } from "./study";
import { addDays, localDay, localHour } from "@/lib/planning/dates";
import { isActive, streaks } from "@/lib/planning/streaks";
import { weakTopics } from "@/lib/planning/weak-topics";

/** Everything the "Today" dashboard shows, for one student. */
export async function getDashboard(userId: string, now = new Date()) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, timezone: true, dailyGoalMinutes: true } });
  const today = localDay(now, user.timezone);
  const since = addDays(today, -120);
  // Admin → Program access: leave out courses this person can't open.
  const reach = { archivedAt: null, ...courseAccessWhere(await programAccess(userId)) };
  const [days, review, courses, attempts, confusing, leeches, planItems] = await Promise.all([
    db.studyDay.findMany({ where: { userId, day: { gte: since } }, orderBy: { day: "asc" } }),
    getReviewCounts(userId, now),
    db.course.findMany({
      where: { userId, ...reach, status: { in: ["GENERATING", "ACTIVE"] } },
      orderBy: [{ lastOpenedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 8,
      select: { id: true, title: true, progressPct: true, subject: true },
    }),
    db.questionAttempt.findMany({
      where: { userId, createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) }, course: reach },
      select: { topic: true, lessonId: true, score: true, createdAt: true, courseId: true },
    }),
    db.lessonProgress.findMany({
      where: { userId, confusing: true, completedAt: null, lesson: { skip: false }, course: reach },
      take: 5,
      select: { lesson: { select: { id: true, title: true, courseId: true } } },
    }),
    db.cardState.findMany({
      where: { userId, lapses: { gte: 2 }, course: reach },
      orderBy: { lapses: "desc" },
      take: 5,
      select: { lapses: true, flashcard: { select: { front: true, courseId: true, lessonId: true } } },
    }),
    db.planItem.findMany({
      where: { plan: { userId, course: reach }, day: { lte: today }, kind: "LESSON" },
      orderBy: [{ day: "asc" }, { order: "asc" }],
      select: { day: true, minutes: true, plan: { select: { courseId: true, course: { select: { title: true } } } }, lesson: { select: { id: true, title: true, progress: { where: { userId }, select: { completedAt: true } } } } },
    }),
  ]);

  const todayRow = days.find((d) => d.day === today);
  const streak = streaks(days.filter(isActive).map((d) => d.day), today);
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i - 13);
    const row = days.find((d) => d.day === day);
    return { day, minutes: row?.minutes ?? 0, active: row ? isActive(row) : false };
  });

  // Weak topics, with the lesson to go back to.
  const weak = weakTopics(attempts, now);
  const lessonIds = [...new Set([...weak.map((w) => w.lessonId).filter(Boolean), ...leeches.map((l) => l.flashcard.lessonId)])] as string[];
  const lessons = await db.lesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, title: true, courseId: true } });
  const lessonById = new Map(lessons.map((l) => [l.id, l]));

  const outlines = await Promise.all(courses.map((c) => getStudyOutline(userId, c.id)));
  const plan = planItems.filter((p) => p.lesson && !p.lesson.progress[0]?.completedAt);

  return {
    name: user.name,
    today,
    hour: localHour(now, user.timezone),
    goal: { minutes: todayRow?.minutes ?? 0, target: user.dailyGoalMinutes },
    todayCounts: { cards: todayRow?.cardsReviewed ?? 0, questions: todayRow?.questionsAnswered ?? 0, lessons: todayRow?.lessonsCompleted ?? 0 },
    streak,
    last14,
    review: { due: review.due, new: review.new },
    courses: courses.map((c, i) => {
      const o = outlines[i];
      const resume = o.resume ? o.units.flatMap((u) => u.lessons).find((l) => l.id === o.resume!.id) : null;
      return { id: c.id, title: c.title, subject: c.subject, pct: o.pct, done: o.done, total: o.total, resume: resume ? { id: resume.id, title: resume.title, reason: o.resume!.reason } : null };
    }),
    weakTopics: weak.map((w) => ({ topic: w.topic, score: w.score, attempts: w.attempts, lesson: w.lessonId ? (lessonById.get(w.lessonId) ?? null) : null })),
    confusing: confusing.map((c) => c.lesson),
    leeches: leeches.map((l) => ({ front: l.flashcard.front, lapses: l.lapses, lesson: lessonById.get(l.flashcard.lessonId) ?? null })),
    plan: plan.slice(0, 6).map((p) => ({ day: p.day, overdue: p.day < today, minutes: p.minutes, courseId: p.plan.courseId, courseTitle: p.plan.course.title, lessonId: p.lesson!.id, lessonTitle: p.lesson!.title })),
    overdueCount: plan.filter((p) => p.day < today).length,
  };
}

/** Streak, today's minutes and cards due, for the small summary on the library page. */
export async function getTodaySummary(userId: string, now = new Date()) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, dailyGoalMinutes: true } });
  const today = localDay(now, user.timezone);
  const [days, review, anyCourse] = await Promise.all([
    db.studyDay.findMany({ where: { userId, day: { gte: addDays(today, -400) } } }),
    getReviewCounts(userId, now),
    db.course.count({ where: { userId, status: { in: ["GENERATING", "ACTIVE"] } } }),
  ]);
  return {
    hasStudied: anyCourse > 0,
    streak: streaks(days.filter(isActive).map((d) => d.day), today).current,
    minutes: days.find((d) => d.day === today)?.minutes ?? 0,
    goal: user.dailyGoalMinutes,
    cards: review.due + review.new,
  };
}

/** Average score per unit (each question's latest attempt counts), for the course page and dashboard. */
export async function getUnitScores(userId: string, courseId: string) {
  const [units, attempts] = await Promise.all([
    db.unit.findMany({
      where: { courseId, course: { userId } },
      orderBy: { order: "asc" },
      select: { id: true, title: true, lessons: { where: { skip: false }, select: { questions: { where: { scope: "LESSON" }, select: { id: true } } } } },
    }),
    db.questionAttempt.findMany({ where: { userId, courseId, questionId: { not: null } }, orderBy: { createdAt: "desc" }, distinct: ["questionId"], select: { questionId: true, score: true } }),
  ]);
  const latest = new Map(attempts.map((a) => [a.questionId!, a.score]));
  return units
    .map((u) => {
      const qs = u.lessons.flatMap((l) => l.questions.map((q) => q.id));
      const answered = qs.filter((id) => latest.has(id));
      const score = answered.length ? answered.reduce((s, id) => s + latest.get(id)!, 0) / answered.length : null;
      return { id: u.id, title: u.title, questions: qs.length, answered: answered.length, score };
    })
    .filter((u) => u.questions > 0);
}
