import "server-only";
import { courseAccessWhere, programAccess } from "./program-access";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { bumpActivity } from "./activity";
import { createScheduler, isRating, previewIntervals, reviewCard, type ReviewRating, type StoredCard } from "@/lib/srs/fsrs";
import { buildQueue, endOfDay, NEW_CARDS_PER_DAY, startOfDay } from "@/lib/srs/queue";

/**
 * Flashcard review across all of a student's courses (or one course).
 * The server is the only place cards are scheduled: the browser just shows
 * cards and sends ratings.
 */

export class ReviewError extends Error {}

const scheduler = createScheduler();

/** Cards that can be studied: from included, written lessons of active (non-archived) courses. */
const studyable = (userId: string, courseId?: string, access: object = {}) => ({
  // `access`: Admin → Program access can put some courses out of reach (courseAccessWhere).
  course: { userId, archivedAt: null, ...(courseId ? { id: courseId } : {}), ...access },
  lesson: { skip: false, generatedAt: { not: null } },
});

async function userTimeZone(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return u?.timezone ?? "UTC";
}
async function newPerDay(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { newCardsPerDay: true } });
  return u?.newCardsPerDay ?? NEW_CARDS_PER_DAY;
}

const toStored = (s: {
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: StoredCard["state"];
  lastReview: Date | null;
}): StoredCard => ({
  due: s.due,
  stability: s.stability,
  difficulty: s.difficulty,
  scheduledDays: s.scheduledDays,
  learningSteps: s.learningSteps,
  reps: s.reps,
  lapses: s.lapses,
  state: s.state,
  lastReview: s.lastReview,
});

/** New cards: never reviewed, from lessons the student has opened, in course order. */
async function newCandidates(userId: string, courseId: string | undefined, take: number) {
  if (take <= 0) return [];
  return db.flashcard.findMany({
    where: {
      ...studyable(userId, courseId, courseAccessWhere(await programAccess(userId))),
      states: { none: { userId } },
      lesson: { skip: false, generatedAt: { not: null }, progress: { some: { userId } } },
    },
    orderBy: [{ course: { createdAt: "asc" } }, { lesson: { unit: { order: "asc" } } }, { lesson: { order: "asc" } }, { order: "asc" }],
    take,
    select: { id: true },
  });
}

async function newIntroducedToday(userId: string, since: Date) {
  return db.reviewLog.count({ where: { userId, stateBefore: "NEW", reviewedAt: { gte: since } } });
}

export type ReviewItem = {
  flashcardId: string;
  front: string;
  back: string;
  pageRefs: number[];
  bookId: string;
  sourceKind: "BOOK" | "SLIDES";
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  state: StoredCard["state"];
  intervals: Record<ReviewRating, string>;
};

/** Today's queue: due cards first (oldest first), then new cards up to the daily limit. */
export async function getReviewQueue(userId: string, opts: { courseId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const tz = await userTimeZone(userId);
  const [dayStart, dayEnd] = [startOfDay(now, tz), endOfDay(now, tz)];
  const scheduled = await db.cardState.findMany({
    where: { userId, due: { lt: dayEnd }, flashcard: studyable(userId, opts.courseId, courseAccessWhere(await programAccess(userId))) },
    select: { flashcardId: true, due: true, state: true },
  });
  const [introduced, perDay] = await Promise.all([newIntroducedToday(userId, dayStart), newPerDay(userId)]);
  const fresh = await newCandidates(userId, opts.courseId, perDay - introduced);
  const q = buildQueue({
    scheduled,
    newCandidates: fresh.map((c) => c.id),
    newIntroducedToday: introduced,
    newPerDay: perDay,
    now,
    endOfToday: dayEnd,
  });
  const ids = [...q.due, ...q.fresh];
  const cards = await db.flashcard.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      front: true,
      back: true,
      pageRefs: true,
      courseId: true,
      lessonId: true,
      course: { select: { title: true, bookId: true, book: { select: { kind: true } } } },
      lesson: { select: { title: true } },
      states: { where: { userId } },
    },
  });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const items: ReviewItem[] = ids
    .map((id) => byId.get(id))
    .filter((c) => c !== undefined)
    .map((c) => {
      const stored = c.states[0] ? toStored(c.states[0]) : null;
      return {
        flashcardId: c.id,
        front: c.front,
        back: c.back,
        pageRefs: c.pageRefs,
        bookId: c.course.bookId,
        sourceKind: c.course.book.kind,
        courseId: c.courseId,
        courseTitle: c.course.title,
        lessonId: c.lessonId,
        lessonTitle: c.lesson.title,
        state: stored?.state ?? "NEW",
        intervals: previewIntervals(stored, now, scheduler),
      };
    });
  return { items, dueCount: q.due.length, newCount: q.fresh.length };
}

/** Record a rating and schedule the card's next review. Returns when it's due next. */
export async function reviewFlashcard(userId: string, flashcardId: string, rating: unknown, opts: { durationMs?: unknown; now?: Date } = {}) {
  if (!isRating(rating)) throw new ReviewError("Choose Again, Hard, Good or Easy.");
  const now = opts.now ?? new Date();
  const card = await db.flashcard.findFirst({
    where: { id: flashcardId, course: { userId } },
    select: { id: true, courseId: true, states: { where: { userId } } },
  });
  if (!card) throw new NotFoundError("Card not found");
  const before = card.states[0] ? toStored(card.states[0]) : null;
  const next = reviewCard(before, rating, now, scheduler);
  const duration = typeof opts.durationMs === "number" && Number.isFinite(opts.durationMs) ? Math.max(0, Math.min(Math.round(opts.durationMs), 3_600_000)) : null;
  await db.$transaction([
    db.cardState.upsert({
      where: { userId_flashcardId: { userId, flashcardId } },
      create: { userId, flashcardId, courseId: card.courseId, ...next },
      update: next,
    }),
    db.reviewLog.create({
      data: {
        userId,
        courseId: card.courseId,
        flashcardId,
        rating,
        stateBefore: before?.state ?? "NEW",
        dueBefore: before?.due ?? null,
        scheduledDays: next.scheduledDays,
        durationMs: duration,
        reviewedAt: now,
      },
    }),
  ]);
  await bumpActivity(userId, "cardsReviewed", now);
  return { due: next.due.toISOString(), state: next.state, intervals: previewIntervals(next, now, scheduler) };
}

/** Due + new counts per course, for the Review page and the nav badge. */
export async function getReviewCounts(userId: string, now = new Date()) {
  const tz = await userTimeZone(userId);
  const [dayStart, dayEnd] = [startOfDay(now, tz), endOfDay(now, tz)];
  const courses = await db.course.findMany({
    where: { userId, archivedAt: null, flashcards: { some: {} }, ...courseAccessWhere(await programAccess(userId)) },
    orderBy: [{ lastOpenedAt: { sort: "desc", nulls: "last" } }],
    select: { id: true, title: true, _count: { select: { flashcards: true } } },
  });
  const [introduced, perDay] = await Promise.all([newIntroducedToday(userId, dayStart), newPerDay(userId)]);
  const allowance = Math.max(0, perDay - introduced);
  const rows = await Promise.all(
    courses.map(async (c) => {
      const [scheduled, unseen] = await Promise.all([
        db.cardState.findMany({ where: { userId, courseId: c.id, due: { lt: dayEnd }, flashcard: studyable(userId, c.id) }, select: { flashcardId: true, due: true, state: true } }),
        db.flashcard.count({ where: { ...studyable(userId, c.id), states: { none: { userId } }, lesson: { skip: false, generatedAt: { not: null }, progress: { some: { userId } } } } }),
      ]);
      const due = buildQueue({ scheduled, newCandidates: [], newIntroducedToday: 0, now, endOfToday: dayEnd }).due.length;
      return { courseId: c.id, title: c.title, total: c._count.flashcards, due, unseen, new: Math.min(unseen, allowance) };
    }),
  );
  const due = rows.reduce((n, r) => n + r.due, 0);
  const unseen = rows.reduce((n, r) => n + r.unseen, 0);
  return { courses: rows, due, new: Math.min(unseen, allowance), newAllowance: allowance };
}

/** Every card in a course with this student's schedule, for browsing. */
export async function getCourseFlashcards(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, bookId: true } });
  if (!course) throw new NotFoundError("Course not found");
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false, flashcards: { some: {} } },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      flashcards: {
        orderBy: { order: "asc" },
        select: { id: true, front: true, back: true, pageRefs: true, states: { where: { userId }, select: { due: true, state: true, reps: true, lapses: true } } },
      },
    },
  });
  return {
    bookId: course.bookId,
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      cards: l.flashcards.map((f) => ({ id: f.id, front: f.front, back: f.back, pageRefs: f.pageRefs, state: f.states[0]?.state ?? ("NEW" as const), due: f.states[0]?.due ?? null, reps: f.states[0]?.reps ?? 0, lapses: f.states[0]?.lapses ?? 0 })),
    })),
  };
}

/** Save the browser's time zone so "today" (daily limits, later streaks) matches the student's day. */
export async function setTimeZone(userId: string, timeZone: unknown) {
  if (typeof timeZone !== "string" || timeZone.length > 64) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return;
  }
  await db.user.update({ where: { id: userId }, data: { timezone: timeZone } });
}

