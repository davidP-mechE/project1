import { addDays, type Day } from "./dates";

/**
 * Streaks: consecutive days with some studying. Pure and unit-tested.
 * A streak isn't broken until a whole day is missed: if you studied
 * yesterday but not yet today, the streak is still alive ("study today to
 * keep it going").
 */
export function streaks(activeDays: Iterable<Day>, today: Day): { current: number; longest: number; alive: boolean; studiedToday: boolean } {
  const days = new Set(activeDays);
  const studiedToday = days.has(today);
  let current = 0;
  for (let d = studiedToday ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;

  let longest = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // not the start of a run
    let n = 0;
    for (let x = d; days.has(x); x = addDays(x, 1)) n++;
    longest = Math.max(longest, n);
  }
  return { current, longest, alive: current > 0, studiedToday };
}

/** Did this day count as studying? Any activity at all. */
export const isActive = (d: { minutes: number; cardsReviewed: number; questionsAnswered: number; lessonsCompleted: number }) =>
  d.minutes > 0 || d.cardsReviewed > 0 || d.questionsAnswered > 0 || d.lessonsCompleted > 0;
