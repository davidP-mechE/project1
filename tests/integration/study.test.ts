import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { AiError } from "@/server/ai/writer";
import {
  getLatestAttempts,
  getStudyOutline,
  markLessonViewed,
  pagesForGrading,
  recomputeCourseProgress,
  setLessonCompleted,
  setLessonConfusing,
  StudyError,
  submitAttempt,
} from "@/server/study";
import { createUser, resetDb } from "../helpers/db";
import { FakeGrader } from "../helpers/fake-claude";

vi.mock("@/server/queue", () => ({ enqueueGeneration: async () => {}, enqueueBookProcessing: async () => ({ id: "job" }) }));

/** An ACTIVE course: 8 pages, 2 units, 3 included lessons (2 written) + 1 skipped, with practice questions. */
async function course() {
  const user = await createUser();
  const book = await db.book.create({
    data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 8 },
  });
  await db.page.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({ bookId: book.id, pageNumber: i + 1, text: `Page ${i + 1} text about current.`, charCount: 30, width: 612, height: 792 })),
  });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Circuits", status: "ACTIVE" } });
  const written = { status: "READY" as const, generatedAt: new Date(), content: { objectives: [], explanation: "x", workedExamples: [], keyTerms: [] } };
  const u1 = await db.unit.create({
    data: {
      courseId: c.id,
      order: 0,
      title: "1 Charge",
      lessons: {
        create: [
          { courseId: c.id, order: 0, title: "1.1 Basics", pageStart: 3, pageEnd: 4, ...written },
          { courseId: c.id, order: 1, title: "1.2 Current", pageStart: 5, pageEnd: 6, ...written },
          { courseId: c.id, order: 2, title: "Front matter", pageStart: 1, pageEnd: 2, skip: true },
        ],
      },
    },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  const u2 = await db.unit.create({
    data: { courseId: c.id, order: 1, title: "2 Ohm", lessons: { create: [{ courseId: c.id, order: 0, title: "2.1 Ohm's law", pageStart: 7, pageEnd: 8 }] } },
    include: { lessons: true },
  });
  const [basics, current, skipped] = u1.lessons;
  const ohm = u2.lessons[0];
  const q = (type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP", order: number, extra: object) =>
    db.question.create({
      data: { courseId: c.id, lessonId: current.id, type, order, prompt: `Q${order}`, answer: "", explanation: "Because.", topic: `Topic ${order}`, ...extra },
    });
  const mcq = await q("MULTIPLE_CHOICE", 0, { choices: ["Volt", "Ampere", "Ohm", "Watt"], correctChoice: 1, pageRefs: [6] });
  const short = await q("SHORT_ANSWER", 1, { answer: "The rate of flow of charge.", pageRefs: [6, 99] });
  const step = await q("STEP_BY_STEP", 2, { answer: "2 A", steps: ["I = Q/t", "I = 2 A"], pageRefs: [] });
  return { user, book, course: c, lessons: { basics, current, skipped, ohm }, units: { u1, u2 }, questions: { mcq, short, step } };
}

let grader: FakeGrader;
beforeEach(async () => {
  await resetDb();
  grader = new FakeGrader();
});

describe("lesson progress", () => {
  it("marks lessons complete and keeps the course percentage up to date", async () => {
    const { user, course: c, lessons } = await course();
    expect(await setLessonCompleted(user.id, lessons.basics.id, true)).toBe(33); // 1 of 3 included lessons
    expect((await db.course.findUniqueOrThrow({ where: { id: c.id } })).progressPct).toBe(33);
    await setLessonCompleted(user.id, lessons.current.id, true);
    const outline = await getStudyOutline(user.id, c.id);
    expect(outline).toMatchObject({ done: 2, total: 3, pct: 67 });
    expect(outline.units.map((u) => u.progress)).toEqual([
      { done: 2, total: 2, pct: 100 },
      { done: 0, total: 1, pct: 0 },
    ]);
    // The skipped lesson isn't listed or counted.
    expect(outline.units[0].lessons.map((l) => l.title)).toEqual(["1.1 Basics", "1.2 Current"]);
    expect(await setLessonCompleted(user.id, lessons.current.id, false)).toBe(33);
  });

  it("can't complete a skipped lesson", async () => {
    const { user, lessons } = await course();
    await expect(setLessonCompleted(user.id, lessons.skipped.id, true)).rejects.toBeInstanceOf(StudyError);
  });

  it("suggests where to continue", async () => {
    const { user, course: c, lessons } = await course();
    expect((await getStudyOutline(user.id, c.id)).resume).toEqual({ id: lessons.basics.id, reason: "start" });
    await markLessonViewed(user.id, lessons.current.id);
    expect((await getStudyOutline(user.id, c.id)).resume).toEqual({ id: lessons.current.id, reason: "continue" });
    await setLessonCompleted(user.id, lessons.current.id, true);
    // 2.1 isn't written yet, so the unfinished 1.1 is next.
    expect((await getStudyOutline(user.id, c.id)).resume).toEqual({ id: lessons.basics.id, reason: "next" });
  });

  it("recomputes after the outline changes (e.g. a lesson is skipped)", async () => {
    const { user, course: c, lessons } = await course();
    await setLessonCompleted(user.id, lessons.basics.id, true);
    await db.lesson.update({ where: { id: lessons.ohm.id }, data: { skip: true } });
    expect(await recomputeCourseProgress(user.id, c.id)).toBe(50);
  });

  it("records 'confusing' without completing", async () => {
    const { user, lessons } = await course();
    await setLessonConfusing(user.id, lessons.basics.id, true);
    const p = await db.lessonProgress.findFirstOrThrow({ where: { userId: user.id, lessonId: lessons.basics.id } });
    expect(p).toMatchObject({ confusing: true, completedAt: null });
  });

  it("is private: another student can't touch your lessons or read your course", async () => {
    const { course: c, lessons } = await course();
    const other = await createUser("Other");
    await expect(setLessonCompleted(other.id, lessons.basics.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(markLessonViewed(other.id, lessons.basics.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getStudyOutline(other.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.lessonProgress.count()).toBe(0);
  });
});

describe("practice attempts", () => {
  it("checks multiple choice locally, without Claude", async () => {
    const { user, questions } = await course();
    expect(await submitAttempt(user.id, questions.mcq.id, { choice: 1 }, { grader })).toMatchObject({ correct: true, verdict: "CORRECT", gradedBy: "LOCAL", choice: 1 });
    expect(await submitAttempt(user.id, questions.mcq.id, { choice: 3 }, { grader })).toMatchObject({ correct: false, verdict: "INCORRECT" });
    await expect(submitAttempt(user.id, questions.mcq.id, { choice: 7 }, { grader })).rejects.toThrow("Pick one of the answers first.");
    expect(grader.calls).toHaveLength(0);
    expect(await db.usageEvent.count()).toBe(0);
  });

  it("accepts an exact or numeric match without calling Claude", async () => {
    const { user, questions } = await course();
    expect(await submitAttempt(user.id, questions.short.id, { response: "the rate of flow of charge" }, { grader })).toMatchObject({ correct: true, gradedBy: "LOCAL" });
    expect(await submitAttempt(user.id, questions.step.id, { response: "I = 6/3 = 2 A" }, { grader })).toMatchObject({ correct: false, gradedBy: "CLAUDE" }); // two numbers: Claude decides
    expect(await submitAttempt(user.id, questions.step.id, { response: "2.0 A" }, { grader })).toMatchObject({ correct: true, gradedBy: "LOCAL" });
    expect(grader.calls).toHaveLength(1);
  });

  it("grades written answers with Claude, sending only the question's pages, and records the cost", async () => {
    const { user, course: c, lessons, questions } = await course();
    const a = await submitAttempt(user.id, questions.short.id, { response: "How fast charge moves" }, { grader });
    expect(a).toMatchObject({ verdict: "PARTIAL", correct: false, score: 0.5, gradedBy: "CLAUDE", response: "How fast charge moves" });
    expect(a.feedback).toContain("(p. 6)");
    const sent = grader.calls[0];
    expect(sent.pages.map((p) => p.pageNumber)).toEqual([6]); // p. 99 is outside the lesson and ignored
    expect(sent).toMatchObject({ type: "SHORT_ANSWER", answer: "The rate of flow of charge.", response: "How fast charge moves" });
    const usage = await db.usageEvent.findFirstOrThrow();
    expect(usage).toMatchObject({ userId: user.id, courseId: c.id, lessonId: lessons.current.id, feature: "GRADING", model: "claude-opus-5-5" });
    expect(usage.costMicroUsd).toBeGreaterThan(0);
    const saved = await db.questionAttempt.findFirstOrThrow({ where: { gradedBy: "CLAUDE" } });
    expect(saved).toMatchObject({ topic: "Topic 1", model: "claude-opus-5-5", score: 0.5 });
  });

  it("uses the lesson's pages when a question cites none", async () => {
    const { user, questions } = await course();
    await submitAttempt(user.id, questions.step.id, { response: "3 A" }, { grader });
    expect(grader.calls[0].pages.map((p) => p.pageNumber)).toEqual([5, 6]);
    expect(pagesForGrading({ pageRefs: [] }, { pageStart: 1, pageEnd: 100 })).toHaveLength(6); // capped
  });

  it("explains failures and still records what Claude billed", async () => {
    const { user, questions } = await course();
    grader.next = new AiError("retryable", "Claude is busy right now.", "529", [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 10, outputTokens: 0 } }]);
    await expect(submitAttempt(user.id, questions.short.id, { response: "something" }, { grader })).rejects.toMatchObject({ message: "Claude is busy right now.", status: 503 });
    expect(await db.questionAttempt.count()).toBe(0);
    expect(await db.usageEvent.count()).toBe(1);
  });

  it("without a grader, written answers that don't match exactly can't be checked", async () => {
    const { user, questions } = await course();
    await expect(submitAttempt(user.id, questions.short.id, { response: "something" }, { grader: null })).rejects.toMatchObject({ status: 503 });
    expect(await submitAttempt(user.id, questions.step.id, { response: "2 A" }, { grader: null })).toMatchObject({ correct: true });
  });

  it("limits Claude-graded answers per hour", async () => {
    const { user, course: c, questions } = await course();
    await db.questionAttempt.createMany({
      data: Array.from({ length: 60 }, () => ({ userId: user.id, courseId: c.id, topic: "t", response: "x", verdict: "INCORRECT" as const, correct: false, score: 0, feedback: "", gradedBy: "CLAUDE" as const })),
    });
    await expect(submitAttempt(user.id, questions.short.id, { response: "something" }, { grader })).rejects.toMatchObject({ status: 429 });
    expect(grader.calls).toHaveLength(0);
    // Free checks still work.
    expect(await submitAttempt(user.id, questions.mcq.id, { choice: 1 }, { grader })).toMatchObject({ correct: true });
  });

  it("rejects empty answers and other students' questions", async () => {
    const { user, questions } = await course();
    await expect(submitAttempt(user.id, questions.short.id, { response: "  " }, { grader })).rejects.toThrow("Write an answer first.");
    const other = await createUser("Other");
    await expect(submitAttempt(other.id, questions.mcq.id, { choice: 1 }, { grader })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getLatestAttempts(other.id, questions.mcq.lessonId!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows each question's latest attempt and the practice score", async () => {
    const { user, lessons, questions } = await course();
    await submitAttempt(user.id, questions.mcq.id, { choice: 0 }, { grader });
    await new Promise((r) => setTimeout(r, 5));
    await submitAttempt(user.id, questions.mcq.id, { choice: 1 }, { grader });
    await submitAttempt(user.id, questions.short.id, { response: "nope" }, { grader });
    const { latest, summary } = await getLatestAttempts(user.id, lessons.current.id);
    expect(latest.get(questions.mcq.id)).toMatchObject({ correct: true, choice: 1 });
    expect(summary).toEqual({ total: 3, answered: 2, correct: 1 });
  });

  it("keeps attempt history when questions are regenerated", async () => {
    const { user, questions } = await course();
    await submitAttempt(user.id, questions.mcq.id, { choice: 2 }, { grader });
    await db.question.deleteMany({ where: { id: questions.mcq.id } });
    const kept = await db.questionAttempt.findFirstOrThrow();
    expect(kept).toMatchObject({ questionId: null, topic: "Topic 0", correct: false });
  });
});
