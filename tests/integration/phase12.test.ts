import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { NotFoundError, deleteCourse } from "@/server/courses";
import { submitAttempt } from "@/server/study";
import { generateSkillQuestions, getDueQuestions, getErrorLog, getSkillDrill, getSkills, ReviewError } from "@/server/review";
import { detectSubject, getSubjectMastery, setCourseSubject } from "@/server/subjects";
import { CatalogError, enroll, listCatalog, publishCourse } from "@/server/catalog";
import { getUsage } from "@/server/limits";
import { skillKey } from "@/lib/mastery/review";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeGrader, FakeWriter } from "../helpers/fake-claude";

vi.mock("@/server/queue", async (orig) => ({ ...(await orig<typeof import("@/server/queue")>()), enqueueGeneration: async () => {}, enqueueBookProcessing: async () => ({ id: "job" }), enqueueBookEmbedding: async () => {} }));

/** A generated physics course: 2 lessons, 3 questions each (two topics), pages, a chunk, a figure, files in storage. */
async function course(title = "University Physics") {
  const user = await createUser();
  const prefix = `users/${user.id}/books/b${Math.random().toString(36).slice(2)}/`;
  await storage.put(`${prefix}original.pdf`, Buffer.from("%PDF-1.4 test"), "application/pdf");
  await storage.put(`${prefix}cover.jpg`, Buffer.from("jpg"), "image/jpeg");
  await storage.put(`${prefix}figures/p2-0.png`, Buffer.from("png"), "image/png");
  const book = await db.book.create({ data: { userId: user.id, originalFilename: "physics.pdf", storageKey: `${prefix}original.pdf`, coverKey: `${prefix}cover.jpg`, sizeBytes: BigInt(5_000_000), status: "READY", pageCount: 10 } });
  await db.page.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ bookId: book.id, pageNumber: i + 1, text: `Page ${i + 1}: current is the rate of flow of charge. Ohm's law says V = IR.`, charCount: 70, width: 600, height: 800 })) });
  await db.figure.create({ data: { bookId: book.id, pageNumber: 2, index: 0, storageKey: `${prefix}figures/p2-0.png`, width: 200, height: 150 } });
  await db.chunk.create({ data: { bookId: book.id, ordinal: 0, pageStart: 1, pageEnd: 2, text: "Current is the rate of flow of charge.", tokenCount: 9 } });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title, status: "ACTIVE", settings: DEFAULT_SETTINGS } });
  const unit = await db.unit.create({ data: { courseId: c.id, order: 0, title: "Electricity" } });
  const lessons = [];
  for (const [i, t] of ["Current", "Ohm's law"].entries()) {
    const l = await db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order: i, title: t, pageStart: i * 5 + 1, pageEnd: i * 5 + 5, status: "READY", generatedAt: new Date(), content: { objectives: [], explanation: "x", workedExamples: [], keyTerms: [] } } });
    lessons.push(l);
    for (let k = 0; k < 3; k++) {
      await db.question.create({
        data: { courseId: c.id, lessonId: l.id, type: "MULTIPLE_CHOICE", order: k, prompt: `${t} question ${k}`, choices: ["Right", "Wrong"], correctChoice: 0, answer: "Right", explanation: "Because the book says so.", topic: k === 2 ? "Units" : t, pageRefs: [l.pageStart] },
      });
    }
    await db.flashcard.create({ data: { courseId: c.id, lessonId: l.id, order: 0, front: `What is ${t}?`, back: "See the book.", pageRefs: [l.pageStart] } });
  }
  return { user, book, course: c, lessons };
}

const grader = new FakeGrader();
const answer = async (userId: string, prompt: string, right: boolean) => {
  const q = await db.question.findFirstOrThrow({ where: { prompt } });
  return submitAttempt(userId, q.id, { choice: right ? 0 : 1 }, { grader });
};

beforeEach(resetDb);

describe("error log", () => {
  it("lists missed questions by course and skill, and marks them fixed once answered right", async () => {
    const { user } = await course();
    await answer(user.id, "Current question 0", false);
    await answer(user.id, "Current question 0", false);
    await answer(user.id, "Ohm's law question 2", false); // topic "Units"
    await answer(user.id, "Ohm's law question 0", true);

    let log = await getErrorLog(user.id);
    expect(log).toHaveLength(1);
    expect(log[0].skills.map((s) => [s.topic, s.open])).toEqual([["Current", 1], ["Units", 1]]);
    const entry = log[0].skills[0].entries[0];
    expect(entry).toMatchObject({ prompt: "Current question 0", yourAnswer: "Wrong", correctAnswer: "Right", missed: 2, fixed: false, where: "Lesson: Current" });

    await answer(user.id, "Current question 0", true);
    log = await getErrorLog(user.id);
    expect(log[0].skills.map((s) => s.topic)).toEqual(["Units"]);
    const fixed = await getErrorLog(user.id, { status: "fixed" });
    expect(fixed[0].skills[0].entries[0]).toMatchObject({ prompt: "Current question 0", fixed: true });
    expect((await getErrorLog(user.id, { status: "all" }))[0].total).toBe(2);
    await expect(getErrorLog(user.id, { courseId: "someone-else" })).rejects.toThrow(NotFoundError);
  });
});

describe("Review: skills and drills", () => {
  it("rates skills per course and writes more questions on one skill", async () => {
    const { user, course: c } = await course();
    await answer(user.id, "Current question 0", false);
    await answer(user.id, "Current question 1", true);
    const [skills] = await getSkills(user.id);
    expect(skills.skills.map((s) => [s.topic, s.stats.status])).toEqual([
      ["Current", "shaky"],
      ["Ohm's law", "new"],
      ["Units", "new"],
    ]);
    expect(skills.skills.find((s) => s.topic === "Units")?.questions).toBe(2);

    const drill = await getSkillDrill(user.id, c.id, skillKey("Current"));
    expect(drill.items.map((i) => i.question.prompt)).toEqual(["Current question 0", "Current question 1"]); // the miss first

    const writer = new FakeWriter();
    const fresh = await generateSkillQuestions(user.id, c.id, skillKey("Current"), { writer });
    expect(writer.questionCalls[0]).toMatchObject({ focus: "Current", lessonTitle: "Current" });
    expect(writer.questionCalls[0].avoid).toContain("Current question 0");
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((i) => i.question.topic === "Current")).toBe(true);
    const stored = await db.question.findMany({ where: { courseId: c.id, scope: "DRILL" } });
    expect(stored).toHaveLength(fresh.length);
    // They join the skill, but not the lesson's own practice list.
    expect((await getSkillDrill(user.id, c.id, skillKey("Current"))).items).toHaveLength(2 + fresh.length);
    expect(await db.question.count({ where: { lessonId: stored[0].lessonId!, scope: "LESSON" } })).toBe(3);
    expect(await db.usageEvent.count({ where: { userId: user.id, feature: "QUESTIONS" } })).toBe(1);

    await expect(getSkillDrill(user.id, c.id, "no such skill")).rejects.toThrow(NotFoundError);
    const other = await createUser();
    await expect(generateSkillQuestions(other.id, c.id, skillKey("Current"), { writer })).rejects.toThrow(NotFoundError);
  });

  it("stops when the monthly AI allowance is used", async () => {
    const { user, course: c } = await course();
    await db.usageEvent.create({ data: { userId: user.id, feature: "GRADING", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 50_000_000 } });
    const err = await generateSkillQuestions(user.id, c.id, skillKey("Current"), { writer: new FakeWriter() }).catch((e) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect((err as ReviewError).status).toBe(429);
  });
});

describe("spaced repetition for questions", () => {
  it("brings questions back on schedule", async () => {
    const { user, course: c } = await course();
    await answer(user.id, "Current question 0", false);
    await answer(user.id, "Current question 1", true);
    const now = Date.now();
    expect((await getDueQuestions(user.id)).total).toBe(0);
    const tomorrow = await getDueQuestions(user.id, { now: new Date(now + 1.1 * 86_400_000) });
    expect(tomorrow.total).toBe(2); // the miss (1 day) and the first right answer (1 day)
    expect(tomorrow.courses).toEqual([{ id: c.id, title: c.title, bookId: expect.any(String), due: 2 }]);
    expect(tomorrow.items[0].last).not.toBeNull();
  });
});

describe("Mastery by subject", () => {
  it("detects each course's subject, lets the student change it, and groups mastery", async () => {
    const { user, course: c } = await course("University Physics");
    expect(await detectSubject(c.id)).toBe("physics");
    await answer(user.id, "Current question 0", true);
    let m = await getSubjectMastery(user.id);
    expect(m.subjects.map((s) => [s.id, s.courses.length])).toEqual([["physics", 1]]);
    expect(m.subjects[0].accuracy).toBe(1);
    await setCourseSubject(user.id, c.id, "math");
    m = await getSubjectMastery(user.id);
    expect(m.subjects[0].id).toBe("math");
    await expect(setCourseSubject(user.id, c.id, "astrology")).rejects.toThrow();
    const other = await createUser();
    await expect(setCourseSubject(other.id, c.id, "math")).rejects.toThrow(NotFoundError);
  });
});

describe("Hub: provided courses", () => {
  it("publishes a course and gives each student an independent copy that shares the files", async () => {
    const { course: src, book, lessons } = await course("University Physics Volume 2");
    const entry = await publishCourse(src.id, { description: "Electricity and magnetism.", subject: "physics", license: "CC BY 4.0", attribution: "OpenStax, Rice University", sourceUrl: "https://openstax.org" });
    expect(entry.fileKey).toBe(`catalog/${entry.id}/original.pdf`);
    expect((await storage.getBuffer(entry.fileKey)).toString()).toBe("%PDF-1.4 test");
    expect((await storage.getBuffer(`catalog/${entry.id}/figures/p2-0.png`)).toString()).toBe("png");

    const student = await createUser();
    expect((await listCatalog(student.id)).map((e) => [e.title, e.lessons, e.myCourseId])).toEqual([["University Physics Volume 2", 2, null]]);
    const courseId = await enroll(student.id, entry.id);
    expect(await enroll(student.id, entry.id)).toBe(courseId); // once only
    const copy = await db.course.findUniqueOrThrow({ where: { id: courseId }, include: { book: true, units: true, lessons: true, questions: true, flashcards: true } });
    expect(copy).toMatchObject({ userId: student.id, status: "ACTIVE", catalogEntryId: entry.id, subject: "physics" });
    expect(copy.book).toMatchObject({ userId: student.id, storageKey: entry.fileKey, status: "READY", pageCount: 10 });
    expect(copy.lessons).toHaveLength(2);
    expect(copy.questions).toHaveLength(6);
    expect(copy.flashcards).toHaveLength(2);
    expect(new Set(copy.lessons.map((l) => l.id)).has(lessons[0].id)).toBe(false);
    expect(await db.page.count({ where: { bookId: copy.bookId } })).toBe(10);
    expect(await db.chunk.count({ where: { bookId: copy.bookId } })).toBe(1);
    expect((await db.figure.findFirstOrThrow({ where: { bookId: copy.bookId } })).storageKey).toBe(`catalog/${entry.id}/figures/p2-0.png`);
    expect((await listCatalog(student.id))[0]).toMatchObject({ myCourseId: courseId, students: 1 });

    // Free for the student: doesn't count toward books or storage.
    expect((await getUsage(student.id)).usage).toMatchObject({ books: 0, storageBytes: 0 });

    // The student's progress is theirs; deleting their copy leaves the shared files and the source alone.
    const q = copy.questions[0];
    await submitAttempt(student.id, q.id, { choice: 0 }, { grader });
    await deleteCourse(student.id, courseId);
    expect((await storage.getBuffer(entry.fileKey)).length).toBeGreaterThan(0);
    expect(await db.lesson.count({ where: { courseId: src.id } })).toBe(2);
    expect(await db.book.count({ where: { id: book.id } })).toBe(1);

    // A copy can't be republished; unpublished entries can't be added.
    const again = await enroll(student.id, entry.id);
    await expect(publishCourse(again, { description: "x", subject: "physics", license: "CC BY", attribution: "x" })).rejects.toThrow(CatalogError);
    await db.catalogEntry.update({ where: { id: entry.id }, data: { published: false } });
    await expect(enroll((await createUser()).id, entry.id)).rejects.toThrow(NotFoundError);
    expect(await listCatalog(student.id)).toEqual([]);
  });
});
