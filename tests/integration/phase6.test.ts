import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { getCourseFlashcards, getReviewCounts, getReviewQueue, ReviewError, reviewFlashcard, setTimeZone } from "@/server/srs";
import { createHighlight, deleteHighlight, getCourseNotes, getLessonNotes, NotesError, saveLessonNote, updateHighlight } from "@/server/notes";
import { searchCourse } from "@/server/search";
import { saveLessonEdits } from "@/server/generation/lessons";
import { syncFlashcards } from "@/server/flashcard-store";
import { markLessonViewed } from "@/server/study";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/queue", () => ({ enqueueGeneration: async () => {}, enqueueBookProcessing: async () => ({ id: "job" }) }));

const content = (extra: string) => ({
  objectives: ["Explain current."],
  explanation: `### Current\n\nElectric current is the rate of flow of charge (p. 5). ${extra}`,
  workedExamples: [],
  keyTerms: [{ term: "Ampere", definition: "The unit of current.", pageRefs: [5] }],
});

/** An ACTIVE course with 2 written lessons (3 cards each) and book chunks for search. */
async function course(title = "Circuits") {
  const user = await createUser();
  const book = await db.book.create({ data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 10 } });
  await db.chunk.createMany({
    data: [
      { bookId: book.id, ordinal: 0, pageStart: 5, pageEnd: 5, text: "Kirchhoff's current law says the current entering a junction equals the current leaving it.", tokenCount: 20 },
      { bookId: book.id, ordinal: 1, pageStart: 8, pageEnd: 8, text: "Ohm's law relates voltage, current and resistance in a resistor.", tokenCount: 15 },
    ],
  });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title, status: "ACTIVE" } });
  const unit = await db.unit.create({ data: { courseId: c.id, order: 0, title: "1 Basics" } });
  const mk = (order: number, t: string, s: number, e: number, extra: string) =>
    db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order, title: t, pageStart: s, pageEnd: e, status: "READY", generatedAt: new Date(), content: content(extra) } });
  const l1 = await mk(0, "1.1 Current", 4, 5, "Capacitors store charge.");
  const l2 = await mk(1, "1.2 Ohm's law", 7, 8, "Resistance opposes current. Voltage equals current times resistance.");
  for (const [l, prefix] of [[l1, "A"], [l2, "B"]] as const) {
    await db.flashcard.createMany({ data: [0, 1, 2].map((i) => ({ courseId: c.id, lessonId: l.id, order: i, front: `${prefix} card ${i}`, back: `Back ${i}`, pageRefs: [] })) });
  }
  return { user, book, course: c, l1, l2 };
}

beforeEach(resetDb);

describe("flashcard review", () => {
  it("only offers new cards from lessons the student has opened", async () => {
    const { user, l1 } = await course();
    expect((await getReviewQueue(user.id)).items).toHaveLength(0);
    await markLessonViewed(user.id, l1.id);
    const q = await getReviewQueue(user.id);
    expect(q.items.map((i) => i.front)).toEqual(["A card 0", "A card 1", "A card 2"]);
    expect(q).toMatchObject({ dueCount: 0, newCount: 3 });
    expect(q.items[0].intervals[1]).toMatch(/m$/);
  });

  it("schedules a rating, logs it, and brings 'Again' back soon", async () => {
    const { user, l1 } = await course();
    await markLessonViewed(user.id, l1.id);
    const [first, second] = (await getReviewQueue(user.id)).items;
    const now = new Date();
    const again = await reviewFlashcard(user.id, first.flashcardId, 1, { durationMs: 4200, now });
    expect(again.state).toBe("LEARNING");
    const easy = await reviewFlashcard(user.id, second.flashcardId, 4, { now });
    expect(new Date(easy.due).getTime() - now.getTime()).toBeGreaterThan(20 * 3600_000);
    const log = await db.reviewLog.findFirstOrThrow({ where: { flashcardId: first.flashcardId } });
    expect(log).toMatchObject({ rating: 1, stateBefore: "NEW", durationMs: 4200 });
    // Later: the "Again" card is due; the "Easy" one isn't; the third is still new.
    const q = await getReviewQueue(user.id, { now: new Date(now.getTime() + 15 * 60_000) });
    expect(q.items.map((i) => i.front)).toEqual(["A card 0", "A card 2"]);
    expect(q.items[0].state).toBe("LEARNING");
  });

  it("limits new cards to 20 a day in the student's time zone", async () => {
    const { user, course: c, l1 } = await course();
    await setTimeZone(user.id, "America/Los_Angeles");
    await setTimeZone(user.id, "Not/AZone"); // ignored
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).timezone).toBe("America/Los_Angeles");
    await db.flashcard.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ courseId: c.id, lessonId: l1.id, order: 10 + i, front: `extra ${i}`, back: "x", pageRefs: [] })) });
    await markLessonViewed(user.id, l1.id);
    const now = new Date("2026-11-09T20:00:00Z"); // noon in LA
    const q = await getReviewQueue(user.id, { now });
    expect(q.newCount).toBe(20);
    for (const item of q.items.slice(0, 15)) await reviewFlashcard(user.id, item.flashcardId, 4, { now });
    expect((await getReviewQueue(user.id, { now })).newCount).toBe(5);
    // The next morning in LA, the allowance resets.
    expect((await getReviewQueue(user.id, { now: new Date("2026-11-10T16:00:00Z") })).newCount).toBe(18);
    expect((await getReviewCounts(user.id, now)).new).toBe(5);
  });

  it("filters by course, and skips archived courses and skipped lessons", async () => {
    const a = await course("A course");
    await markLessonViewed(a.user.id, a.l1.id);
    await markLessonViewed(a.user.id, a.l2.id);
    expect((await getReviewQueue(a.user.id, { courseId: a.course.id })).items).toHaveLength(6);
    await db.lesson.update({ where: { id: a.l2.id }, data: { skip: true } });
    expect((await getReviewQueue(a.user.id)).items).toHaveLength(3);
    await db.course.update({ where: { id: a.course.id }, data: { archivedAt: new Date() } });
    expect((await getReviewQueue(a.user.id)).items).toHaveLength(0);
  });

  it("is private and validates ratings", async () => {
    const { user, l1 } = await course();
    await markLessonViewed(user.id, l1.id);
    const card = (await getReviewQueue(user.id)).items[0];
    const other = await createUser("Other");
    await expect(reviewFlashcard(other.id, card.flashcardId, 3)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewFlashcard(user.id, card.flashcardId, 7)).rejects.toBeInstanceOf(ReviewError);
    expect((await getReviewQueue(other.id)).items).toHaveLength(0);
    await expect(getCourseFlashcards(other.id, card.courseId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("keeping review history when cards change", () => {
  it("hand edits update cards in place (by id), so progress survives a typo fix", async () => {
    const { user, l1 } = await course();
    await markLessonViewed(user.id, l1.id);
    const cards = await db.flashcard.findMany({ where: { lessonId: l1.id }, orderBy: { order: "asc" } });
    await reviewFlashcard(user.id, cards[0].id, 3);
    await saveLessonEdits(user.id, l1.id, {
      content: content(""),
      questions: [],
      flashcards: [
        { id: cards[0].id, front: "A card zero (fixed typo)", back: "Back 0", pageRefs: [] },
        { front: "Brand new card", back: "New", pageRefs: [] },
        { id: "someone-elses-card-id", front: "A card 2", back: "Back 2", pageRefs: [] },
      ],
    });
    const after = await db.flashcard.findMany({ where: { lessonId: l1.id }, orderBy: { order: "asc" }, include: { states: true } });
    expect(after.map((c) => c.front)).toEqual(["A card zero (fixed typo)", "Brand new card", "A card 2"]);
    expect(after[0].id).toBe(cards[0].id);
    expect(after[0].states).toHaveLength(1); // progress kept
    expect(after[2].id).toBe(cards[2].id); // unknown id ignored, matched by front instead
    expect(await db.flashcard.findUnique({ where: { id: cards[1].id } })).toBeNull(); // removed
  });

  it("regenerating keeps cards that ask the same thing; logs of deleted cards are kept", async () => {
    const { user, l1 } = await course();
    await markLessonViewed(user.id, l1.id);
    const cards = await db.flashcard.findMany({ where: { lessonId: l1.id }, orderBy: { order: "asc" } });
    await reviewFlashcard(user.id, cards[1].id, 3);
    await reviewFlashcard(user.id, cards[2].id, 3);
    await db.$transaction((tx) =>
      syncFlashcards(tx, l1, [{ front: "a CARD 1 ", back: "Better back", pageRefs: [] }, { front: "Different", back: "x", pageRefs: [] }], false),
    );
    const kept = await db.flashcard.findUniqueOrThrow({ where: { id: cards[1].id }, include: { states: true } });
    expect(kept).toMatchObject({ back: "Better back", order: 0 });
    expect(kept.states).toHaveLength(1);
    expect(await db.reviewLog.count({ where: { userId: user.id } })).toBe(2);
    expect(await db.reviewLog.count({ where: { flashcardId: null } })).toBe(1);
  });
});

describe("highlights and notes", () => {
  it("creates, updates, lists and deletes highlights", async () => {
    const { user, course: c, l1 } = await course();
    const h = await createHighlight(user.id, l1.id, { exact: "rate of flow of charge", prefix: "current is the ", suffix: " (p. 5)", color: "GREEN", note: "Key!" });
    expect(h).toMatchObject({ exact: "rate of flow of charge", color: "GREEN", note: "Key!" });
    await updateHighlight(user.id, h.id, { color: "PINK", note: "Definition of current" });
    await saveLessonNote(user.id, l1.id, "Q = It");
    expect(await getLessonNotes(user.id, l1.id)).toMatchObject({ note: "Q = It", highlights: [{ id: h.id, color: "PINK", note: "Definition of current" }] });
    const all = await getCourseNotes(user.id, c.id);
    expect(all.lessons).toHaveLength(1);
    expect(all.lessons[0]).toMatchObject({ title: "1.1 Current", note: "Q = It", unitTitle: "1 Basics" });
    await deleteHighlight(user.id, h.id);
    await saveLessonNote(user.id, l1.id, "   "); // empty deletes
    expect(await getLessonNotes(user.id, l1.id)).toEqual({ note: "", highlights: [] });
  });

  it("validates input", async () => {
    const { user, l1 } = await course();
    await expect(createHighlight(user.id, l1.id, { exact: "  " })).rejects.toBeInstanceOf(NotesError);
    await expect(createHighlight(user.id, l1.id, { exact: "x".repeat(2001) })).rejects.toBeInstanceOf(NotesError);
    const h = await createHighlight(user.id, l1.id, { exact: "current", color: "PURPLE", prefix: "p".repeat(500) });
    expect(h.color).toBe("YELLOW");
    expect(h.prefix).toHaveLength(32);
    await expect(updateHighlight(user.id, h.id, { color: "PURPLE" })).rejects.toBeInstanceOf(NotesError);
    await expect(saveLessonNote(user.id, l1.id, "x".repeat(20_001))).rejects.toBeInstanceOf(NotesError);
  });

  it("is private", async () => {
    const { user, course: c, l1 } = await course();
    const h = await createHighlight(user.id, l1.id, { exact: "current" });
    const other = await createUser("Other");
    await expect(createHighlight(other.id, l1.id, { exact: "current" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateHighlight(other.id, h.id, { note: "hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteHighlight(other.id, h.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveLessonNote(other.id, l1.id, "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCourseNotes(other.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLessonNotes(user.id, l1.id)).highlights[0].note).toBe("");
  });
});

describe("search", () => {
  it("finds lessons (title and content) and book passages, with snippets", async () => {
    const { user, course: c, l1, l2 } = await course();
    const r = await searchCourse(user.id, c.id, "resistance");
    expect(r.lessons.map((l) => l.id)).toEqual([l2.id]);
    expect(r.lessons[0].snippet).toContain("\u0001Resistance\u0002");
    expect(r.book.map((b) => b.pageStart)).toEqual([8]);
    expect(r.book[0]).toMatchObject({ lessonId: l2.id, lessonTitle: "1.2 Ohm's law" });
    // Stemming and prefix: "currents" matches "current"; "capac" matches "Capacitors".
    expect((await searchCourse(user.id, c.id, "currents")).lessons.length).toBe(2);
    expect((await searchCourse(user.id, c.id, "capac")).lessons.map((l) => l.id)).toEqual([l1.id]);
    // Phrase with an apostrophe, and key terms inside the lesson JSON.
    expect((await searchCourse(user.id, c.id, '"kirchhoff\'s current law"')).book).toHaveLength(1);
    expect((await searchCourse(user.id, c.id, "ampere")).lessons).toHaveLength(2);
    // Exclusion and title weighting.
    expect((await searchCourse(user.id, c.id, "current -capacitors")).lessons.map((l) => l.id)).toEqual([l2.id]);
    expect((await searchCourse(user.id, c.id, "ohm")).lessons[0].id).toBe(l2.id);
  });

  it("is safe with odd input and empty queries", async () => {
    const { user, course: c } = await course();
    for (const q of ["'; DROP TABLE \"Lesson\"; --", "a & | ! <-> :*", "((((", "\u0000"]) {
      await expect(searchCourse(user.id, c.id, q)).resolves.toBeTruthy();
    }
    expect(await searchCourse(user.id, c.id, "   ")).toEqual({ query: null, lessons: [], book: [] });
    expect(await db.lesson.count()).toBe(2);
  });

  it("only searches the student's own course", async () => {
    const a = await course();
    const b = await course("Other course");
    expect((await searchCourse(a.user.id, a.course.id, "resistance")).lessons.every((l) => l.id !== b.l2.id)).toBe(true);
    await expect(searchCourse(b.user.id, a.course.id, "resistance")).rejects.toBeInstanceOf(NotFoundError);
  });
});
