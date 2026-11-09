import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { getCourseMastery, getPracticeSet } from "@/server/mastery";
import { getGameSummary } from "@/server/gamification";
import { submitAttempt } from "@/server/study";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeGrader } from "../helpers/fake-claude";

vi.mock("@/server/queue", async (orig) => ({ ...(await orig<typeof import("@/server/queue")>()), enqueueGeneration: async () => {}, enqueueBookProcessing: async () => ({ id: "job" }), enqueueBookEmbedding: async () => {} }));

async function course() {
  const user = await createUser();
  const book = await db.book.create({ data: { userId: user.id, kind: "SLIDES", originalFilename: "deck.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 10 } });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Deck", status: "ACTIVE", settings: DEFAULT_SETTINGS } });
  const unit = await db.unit.create({ data: { courseId: c.id, order: 0, title: "Unit" } });
  const lessons = [];
  for (const [i, title] of ["Charge", "Current"].entries()) {
    const l = await db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order: i, title, pageStart: i * 5 + 1, pageEnd: i * 5 + 5, status: "READY", generatedAt: new Date(), content: {} } });
    lessons.push(l);
    for (let k = 0; k < 3; k++) {
      await db.question.create({
        data: { courseId: c.id, lessonId: l.id, type: "MULTIPLE_CHOICE", order: k, prompt: `${title} Q${k}`, choices: ["Right", "Wrong"], correctChoice: 0, answer: "", explanation: "Because.", topic: title, pageRefs: [l.pageStart] },
      });
    }
  }
  const skipped = await db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order: 9, title: "Skipped", pageStart: 10, pageEnd: 10, skip: true, status: "READY", generatedAt: new Date(), content: {} } });
  await db.question.create({ data: { courseId: c.id, lessonId: skipped.id, type: "MULTIPLE_CHOICE", order: 0, prompt: "Skip me", choices: ["A"], correctChoice: 0, answer: "", explanation: "", topic: "x", pageRefs: [] } });
  return { user, course: c, lessons };
}

beforeEach(resetDb);

describe("practice and mastery", () => {
  it("rates each lesson and picks practice sets from the weakest material", async () => {
    const { user, course: c, lessons } = await course();
    const grader = new FakeGrader();
    let m = await getCourseMastery(user.id, c.id);
    expect(m.units[0].lessons.map((l) => [l.title, l.mastery.level])).toEqual([["Charge", "new"], ["Current", "new"]]);
    expect(m.questionCount).toBe(6);

    // Master "Charge": answer all three right.
    const charge = await db.question.findMany({ where: { lessonId: lessons[0].id }, orderBy: { order: "asc" } });
    for (const q of charge) await submitAttempt(user.id, q.id, { choice: 0 }, { grader });
    // One wrong answer in "Current".
    const current = await db.question.findMany({ where: { lessonId: lessons[1].id }, orderBy: { order: "asc" } });
    await submitAttempt(user.id, current[0].id, { choice: 1 }, { grader });

    m = await getCourseMastery(user.id, c.id);
    expect(m.units[0].lessons.map((l) => [l.title, l.mastery.level])).toEqual([["Charge", "mastered"], ["Current", "learning"]]);
    expect(m.overall.counts).toMatchObject({ mastered: 1, learning: 1 });

    const set = await getPracticeSet(user.id, c.id, { size: 4 });
    // Unanswered "Current" questions first, then the one answered wrong; never skipped lessons.
    expect(set.questions.slice(0, 3).map((q) => q.question.prompt)).toEqual(["Current Q1", "Current Q2", "Current Q0"]);
    expect(set.questions[3].question.prompt).toMatch(/^Charge Q/); // then a refresher from the mastered lesson
    expect(set.questions.map((q) => q.question.prompt)).not.toContain("Skip me");
    expect(set.questions[2].last).toMatchObject({ correct: false });
    expect(set.questions[0].question).toMatchObject({ correctChoice: 0, choices: ["Right", "Wrong"] });

    const one = await getPracticeSet(user.id, c.id, { lessonId: lessons[0].id });
    expect(one.questions.map((q) => q.lesson?.title)).toEqual(["Charge", "Charge", "Charge"]);
    await expect(getPracticeSet(user.id, c.id, { lessonId: "nope" })).rejects.toThrow(NotFoundError);
  });

  it("is private to the student", async () => {
    const { course: c } = await course();
    const other = await createUser();
    await expect(getCourseMastery(other.id, c.id)).rejects.toThrow(NotFoundError);
    await expect(getPracticeSet(other.id, c.id)).rejects.toThrow(NotFoundError);
  });

  it("counts right answers for quests and XP", async () => {
    const { user, lessons } = await course();
    const grader = new FakeGrader();
    const qs = await db.question.findMany({ where: { lessonId: lessons[0].id } });
    await submitAttempt(user.id, qs[0].id, { choice: 0 }, { grader });
    await submitAttempt(user.id, qs[1].id, { choice: 1 }, { grader });
    const day = await db.studyDay.findFirstOrThrow({ where: { userId: user.id } });
    expect(day).toMatchObject({ questionsAnswered: 2, questionsCorrect: 1 });
    const g = await getGameSummary(user.id);
    expect(g.xp).toBe(2 * 2 + 1);
    expect(g).toMatchObject({ level: 1, streak: 1, week: { answered: 2, correct: 1 } });
    expect(g.quests).toHaveLength(3);
  });
});
