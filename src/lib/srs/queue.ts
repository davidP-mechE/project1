/**
 * The daily review queue: which cards to show, in what order.
 * Pure and unit-tested.
 *
 * - Cards being learned (shown again after minutes) come back once they're due.
 * - Review cards due any time today are shown, oldest due first.
 * - Then new cards, up to a daily limit, in course order. New cards only come
 *   from lessons the student has opened: no quizzing on unread material.
 */

export const NEW_CARDS_PER_DAY = 20;
export const MAX_SESSION = 200;
/** Learning cards due within this window are shown rather than making the student wait. */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

export type QueueCard = { flashcardId: string; due: Date; state: "NEW" | "LEARNING" | "REVIEW" | "RELEARNING" };

export function isDue(card: QueueCard, now: Date, endOfToday: Date): boolean {
  if (card.state === "REVIEW") return card.due < endOfToday;
  return card.due.getTime() <= now.getTime() + LEARN_AHEAD_MS; // learning / relearning
}

export function buildQueue(input: {
  scheduled: QueueCard[]; // cards with review state
  newCandidates: string[]; // never-reviewed cards, in course order
  newIntroducedToday: number;
  newPerDay?: number;
  now: Date;
  endOfToday: Date;
  limit?: number;
}): { due: string[]; fresh: string[] } {
  const limit = input.limit ?? MAX_SESSION;
  const due = input.scheduled
    .filter((c) => isDue(c, input.now, input.endOfToday))
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.flashcardId.localeCompare(b.flashcardId))
    .map((c) => c.flashcardId)
    .slice(0, limit);
  const allowance = Math.max(0, (input.newPerDay ?? NEW_CARDS_PER_DAY) - input.newIntroducedToday);
  const fresh = input.newCandidates.slice(0, Math.min(allowance, limit - due.length));
  return { due, fresh };
}

/**
 * Midnight at the start of `now`'s day in a time zone, as a UTC instant.
 * "Today" is the student's day, not the server's.
 */
export function startOfDay(now: Date, timeZone: string): Date {
  const tz = validTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  // Guess midnight as if the zone were UTC, then correct by the zone's offset at that moment (twice, for DST edges).
  let guess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  for (let i = 0; i < 2; i++) guess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

export function endOfDay(now: Date, timeZone: string): Date {
  // Start of the day 26 hours from the start of today (safe across 23/25-hour DST days).
  return startOfDay(new Date(startOfDay(now, timeZone).getTime() + 26 * 3600_000), timeZone);
}

/** The zone's offset from UTC at an instant, in ms (e.g. +5:30 → 19800000). */
function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function validTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
