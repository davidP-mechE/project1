import { addDays, daysBetween, weekday, type Day } from "./dates";

/**
 * The study-plan scheduler. Pure and unit-tested.
 *
 * Given the lessons still to do (in course order, each with an estimated
 * time), the days the student studies, and the minutes per day:
 *   - if there's room, lessons are PACED evenly up to the finish date (one
 *     lesson every few study days), rather than crammed into the first days;
 *   - if time is tight, each study day is filled up to the daily minutes.
 * Every study day also gets a short flashcard review. If everything can't fit
 * before the target date, it says how many minutes a day would be needed.
 */

export type PlanLesson = { id: string; minutes: number };
export type PlannedItem = { day: Day; kind: "LESSON" | "REVIEW"; lessonId: string | null; minutes: number; order: number };
export type PlanResult = {
  items: PlannedItem[];
  fits: boolean;
  studyDayCount: number;
  finishDay: Day | null; // when the last lesson is scheduled
  neededMinutesPerDay: number; // to finish by the target date
};

export const REVIEW_MINUTES = 10;
export const MAX_PLAN_DAYS = 730;

/** Rough time for a lesson: reading at ~200 words a minute, ~2 minutes per practice question, at least 10 minutes. */
export function estimateLessonMinutes(words: number, questions: number): number {
  return Math.max(10, Math.round(words / 200 + questions * 2));
}

export function studyDaysBetween(start: Day, target: Day, weekdays: number[]): Day[] {
  const set = new Set(weekdays);
  const out: Day[] = [];
  const span = Math.min(daysBetween(start, target), MAX_PLAN_DAYS);
  for (let i = 0; i <= span; i++) {
    const d = addDays(start, i);
    if (set.has(weekday(d))) out.push(d);
  }
  return out;
}

export function buildPlan(input: { lessons: PlanLesson[]; start: Day; target: Day; weekdays: number[]; minutesPerDay: number; review?: boolean }): PlanResult {
  const review = input.review ?? true;
  const days = studyDaysBetween(input.start, input.target, input.weekdays);
  const lessonBudget = Math.max(5, input.minutesPerDay - (review ? REVIEW_MINUTES : 0));
  const totalLessonMinutes = input.lessons.reduce((n, l) => n + l.minutes, 0);
  const neededMinutesPerDay = days.length === 0 ? Infinity : Math.ceil(totalLessonMinutes / days.length) + (review ? REVIEW_MINUTES : 0);

  const items: PlannedItem[] = [];
  let finishDay: Day | null = null;

  // Plenty of time: one lesson per study day at most, spread evenly to the finish date.
  const roomy = input.lessons.length <= days.length && input.lessons.every((l) => l.minutes <= lessonBudget + Math.max(5, lessonBudget * 0.2));
  if (roomy && input.lessons.length > 0) {
    const lessonDay = new Map<number, PlanLesson>();
    input.lessons.forEach((l, i) => lessonDay.set(Math.floor((i * days.length) / input.lessons.length), l));
    days.forEach((day, d) => {
      let order = 0;
      if (review) items.push({ day, kind: "REVIEW", lessonId: null, minutes: REVIEW_MINUTES, order: order++ });
      const l = lessonDay.get(d);
      if (l) {
        items.push({ day, kind: "LESSON", lessonId: l.id, minutes: l.minutes, order: order++ });
        finishDay = day;
      }
    });
    return { items, fits: true, studyDayCount: days.length, finishDay, neededMinutesPerDay };
  }

  let i = 0;
  // Keep scheduling past the target (on the same weekdays) so the student sees the real finish date.
  const allDays = input.lessons.length > 0 ? studyDaysBetween(input.start, addDays(input.start, MAX_PLAN_DAYS), input.weekdays) : days;
  for (const day of allDays) {
    if (i >= input.lessons.length && day > input.target) break;
    let used = 0;
    let order = 0;
    if (review) items.push({ day, kind: "REVIEW", lessonId: null, minutes: REVIEW_MINUTES, order: order++ });
    // At least one lesson per day; more while they fit (going a little over, up to 20%, is fine).
    while (i < input.lessons.length && (used === 0 || used + input.lessons[i].minutes <= lessonBudget * 1.2)) {
      items.push({ day, kind: "LESSON", lessonId: input.lessons[i].id, minutes: input.lessons[i].minutes, order: order++ });
      used += input.lessons[i].minutes;
      finishDay = day;
      i++;
    }
    if (i >= input.lessons.length && day >= input.target) break;
  }
  return {
    items,
    fits: input.lessons.length === 0 || (finishDay !== null && finishDay <= input.target),
    studyDayCount: days.length,
    finishDay,
    neededMinutesPerDay,
  };
}
