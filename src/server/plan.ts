import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { addDays, daysBetween, isDay, localDay, type Day } from "@/lib/planning/dates";
import { buildPlan, estimateLessonMinutes } from "@/lib/planning/study-plan";

/** Study plans: finish a course by a date. One plan per student per course. */

export class PlanError extends Error {}

async function ownedCourse(userId: string, courseId: string) {
  const c = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, user: { select: { timezone: true } } } });
  if (!c) throw new NotFoundError("Course not found");
  return c;
}

/** Included lessons not completed yet, in course order, with an estimated time each. */
async function remainingLessons(userId: string, courseId: string) {
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false, progress: { none: { userId, completedAt: { not: null } } } },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, pageStart: true, pageEnd: true, content: true, _count: { select: { questions: true } } },
  });
  return lessons.map((l) => {
    const c = l.content as { explanation?: string; workedExamples?: unknown[] } | null;
    // Written lessons: from their length. Not yet written: ~4 minutes per book page.
    const words = c?.explanation ? c.explanation.split(/\s+/).length + (c.workedExamples?.length ?? 0) * 120 : (l.pageEnd - l.pageStart + 1) * 4 * 200;
    return { id: l.id, minutes: estimateLessonMinutes(words, l._count.questions) };
  });
}

export async function getPlan(userId: string, courseId: string, now = new Date()) {
  const course = await ownedCourse(userId, courseId);
  const today = localDay(now, course.user.timezone);
  const plan = await db.studyPlan.findUnique({
    where: { userId_courseId: { userId, courseId } },
    include: {
      items: {
        orderBy: [{ day: "asc" }, { order: "asc" }],
        include: { lesson: { select: { id: true, title: true, progress: { where: { userId }, select: { completedAt: true } } } } },
      },
    },
  });
  if (!plan) return { plan: null, today };
  const days = await db.studyDay.findMany({ where: { userId, day: { gte: plan.startDate } }, select: { day: true, cardsReviewed: true } });
  const reviewed = new Set(days.filter((d) => d.cardsReviewed > 0).map((d) => d.day));
  const items = plan.items
    .filter((i) => i.kind === "REVIEW" || i.lesson) // lessons deleted from the outline drop out
    .map((i) => ({
      id: i.id,
      day: i.day,
      kind: i.kind,
      minutes: i.minutes,
      lessonId: i.lesson?.id ?? null,
      title: i.kind === "REVIEW" ? "Review flashcards" : i.lesson!.title,
      done: i.kind === "REVIEW" ? reviewed.has(i.day) : Boolean(i.lesson!.progress[0]?.completedAt),
    }));
  const overdue = items.filter((i) => i.kind === "LESSON" && !i.done && i.day < today).length;
  const lessonsLeft = items.filter((i) => i.kind === "LESSON" && !i.done).length;
  return {
    today,
    plan: {
      targetDate: plan.targetDate,
      studyDays: plan.studyDays,
      minutesPerDay: plan.minutesPerDay,
      startDate: plan.startDate,
      items,
      overdue,
      lessonsLeft,
      daysLeft: Math.max(0, daysBetween(today, plan.targetDate)),
    },
  };
}

/** Make (or remake from today) a plan. Completed lessons are left out. */
export async function savePlan(userId: string, courseId: string, input: { targetDate?: unknown; studyDays?: unknown; minutesPerDay?: unknown }, now = new Date()) {
  const course = await ownedCourse(userId, courseId);
  const today = localDay(now, course.user.timezone);
  const target = input.targetDate;
  if (!isDay(target)) throw new PlanError("Choose a date to finish by.");
  if (target < today) throw new PlanError("The finish date is in the past.");
  if (daysBetween(today, target) > 730) throw new PlanError("Choose a finish date within two years.");
  const weekdays = Array.isArray(input.studyDays) ? [...new Set(input.studyDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (weekdays.length === 0) throw new PlanError("Pick at least one day of the week to study.");
  const minutes = Number(input.minutesPerDay);
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 480) throw new PlanError("Minutes per day must be between 10 and 480.");

  const lessons = await remainingLessons(userId, courseId);
  const result = buildPlan({ lessons, start: today, target: target as Day, weekdays, minutesPerDay: minutes });
  await db.$transaction(async (tx) => {
    const plan = await tx.studyPlan.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, startDate: today, targetDate: target, studyDays: weekdays, minutesPerDay: minutes },
      update: { startDate: today, targetDate: target, studyDays: weekdays, minutesPerDay: minutes },
    });
    await tx.planItem.deleteMany({ where: { planId: plan.id } });
    await tx.planItem.createMany({ data: result.items.map((i) => ({ ...i, planId: plan.id })) });
  });
  return { fits: result.fits, finishDay: result.finishDay, neededMinutesPerDay: Number.isFinite(result.neededMinutesPerDay) ? result.neededMinutesPerDay : null, lessons: lessons.length };
}

export async function deletePlan(userId: string, courseId: string) {
  await ownedCourse(userId, courseId);
  await db.studyPlan.deleteMany({ where: { userId, courseId } });
}

/** A sensible default finish date: 4 weeks from today. */
export const defaultTarget = (today: Day) => addDays(today, 28);
