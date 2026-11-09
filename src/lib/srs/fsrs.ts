import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS, type Grade } from "ts-fsrs";

/**
 * Spaced repetition with FSRS (the scheduler Anki uses), via ts-fsrs.
 * This module only converts between our stored shape and ts-fsrs's, so the
 * rest of the app never depends on the library directly. Pure and unit-tested.
 */

export type SrsStateName = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";
export type ReviewRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export const RATINGS: { value: ReviewRating; label: string; key: string }[] = [
  { value: 1, label: "Again", key: "1" },
  { value: 2, label: "Hard", key: "2" },
  { value: 3, label: "Good", key: "3" },
  { value: 4, label: "Easy", key: "4" },
];

/** What we store per student per card (CardState table). */
export type StoredCard = {
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: SrsStateName;
  lastReview: Date | null;
};

const TO_STATE: Record<SrsStateName, State> = { NEW: State.New, LEARNING: State.Learning, REVIEW: State.Review, RELEARNING: State.Relearning };
const FROM_STATE: Record<State, SrsStateName> = { [State.New]: "NEW", [State.Learning]: "LEARNING", [State.Review]: "REVIEW", [State.Relearning]: "RELEARNING" };

/**
 * The scheduler. Aim for 90% recall; "fuzz" spreads review dates a little so
 * cards learned together don't all come back on the same day (off in tests).
 */
export function createScheduler(opts: { fuzz?: boolean } = {}): FSRS {
  return fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: opts.fuzz ?? true, enable_short_term: true }));
}

const DAY = 24 * 60 * 60 * 1000;

function toCard(stored: StoredCard | null, now: Date): Card {
  if (!stored) return createEmptyCard(now);
  return {
    due: stored.due,
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.lastReview ? Math.max(0, Math.floor((now.getTime() - stored.lastReview.getTime()) / DAY)) : 0,
    scheduled_days: stored.scheduledDays,
    learning_steps: stored.learningSteps,
    reps: stored.reps,
    lapses: stored.lapses,
    state: TO_STATE[stored.state],
    last_review: stored.lastReview ?? undefined,
  };
}

function fromCard(c: Card): StoredCard {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: FROM_STATE[c.state],
    lastReview: c.last_review ?? null,
  };
}

export function isRating(x: unknown): x is ReviewRating {
  return x === 1 || x === 2 || x === 3 || x === 4;
}

/** Apply one rating. `stored` is null for a card the student has never reviewed. */
export function reviewCard(stored: StoredCard | null, rating: ReviewRating, now: Date, scheduler: FSRS): StoredCard {
  const result = scheduler.next(toCard(stored, now), now, rating as unknown as Grade);
  return fromCard(result.card);
}

/** When the card would next be due for each rating, as short labels for the buttons ("10m", "1d", "4d"). */
export function previewIntervals(stored: StoredCard | null, now: Date, scheduler: FSRS): Record<ReviewRating, string> {
  const preview = scheduler.repeat(toCard(stored, now), now);
  const label = (r: Rating) => formatInterval(preview[r as Grade].card.due.getTime() - now.getTime());
  return { 1: label(Rating.Again), 2: label(Rating.Hard), 3: label(Rating.Good), 4: label(Rating.Easy) };
}

/** "<1m", "10m", "3h", "4d", "2mo", "1.5y". */
export function formatInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  const y = d / 365;
  return `${y < 10 ? Math.round(y * 10) / 10 : Math.round(y)}y`;
}
