import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { AiError } from "@/server/ai/writer";
import { createMissingAssessments, queueReadyAssessments, regenerateAssessment, runAssessmentJob } from "@/server/generation/assessments";
import { getCourseAssessments, getTestQuestions, getUnitView, submitTest } from "@/server/assessments";
import { getCourseExport, sqlJs } from "@/server/export";
import { StudyError } from "@/server/study";
import { buildApkg } from "@/lib/export/anki";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeGrader, FakeWriter } from "../helpers/fake-claude";

const queued = vi.hoisted(() => [] as { payload: { kind: string; assessmentId?: string }; priority: number }[]);
vi.mock("@/server/queue", () => ({
  enqueueGeneration: async (jobs: typeof queued) => void queued.push(...jobs),
  enqueueBookProcessing: async () => ({ id: "job" }),
  enqueueBookEmbedding: async () => {},
}));

const content = (t: string) => ({ objectives: [`Explain ${t}.`], explanation: `${t} explained (p. 4).`, workedExamples: [], keyTerms: [{ term: t, definition: `Def of ${t}`, pageRefs: [4] }] });

/** A course with 2 units of written lessons (unit 2's second lesson still being written). */
async function course() {
  const user = await createUser();
  const book = await db.book.create({ data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 20 } });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Circuits", status: "ACTIVE", settings: DEFAULT_SETTINGS } });
  const u1 = await db.unit.create({ data: { courseId: c.id, order: 0, title: "1 Charge" } });
  const u2 = await db.unit.create({ data: { courseId: c.id, order: 1, title: "2 Ohm" } });
  const mk = (unitId: string, order: number, title: string, s: number, e: number, ready = true) =>
    db.lesson.create({
      data: { courseId: c.id, unitId, order, title, pageStart: s, pageEnd: e, status: ready ? "READY" : "GENERATING", ...(ready ? { generatedAt: new Date(), content: content(title) } : {}) },
    });
  const l1 = await mk(u1.id, 0, "Charge", 3, 4);
  const l2 = await mk(u1.id, 1, "Current", 5, 6);
  const l3 = await mk(u2.id, 0, "Resistance", 7, 8);
  const l4 = await mk(u2.id, 1, "Ohm's law", 9, 10, false);
  await db.flashcard.create({ data: { courseId: c.id, lessonId: l1.id, order: 0, front: "What is charge?", back: "A property of matter.", pageRefs: [3] } });
  return { user, course: c, units: [u1, u2], lessons: [l1, l2, l3, l4] };
}

let writer: FakeWriter;
let grader: FakeGrader;
beforeEach(async () => {
  await resetDb();
  queued.length = 0;
  writer = new FakeWriter();
  grader = new FakeGrader();
});

async function drain() {
  while (queued.length) {
    const { payload } = queued.shift()!;
    await runAssessmentJob({ assessmentId: payload.assessmentId! }, { writer });
  }
}

describe("writing unit tests and the final exam", () => {
  it("writes a unit's test once its lessons are done, then the final exam after every unit", async () => {
    const { course: c, units, lessons } = await course();
    expect(await queueReadyAssessments(c.id)).toBe(1); // unit 1 only: unit 2 is still being written
    await drain();
    const a1 = await db.assessment.findFirstOrThrow({ where: { unitId: units[0].id }, include: { questions: true } });
    expect(a1).toMatchObject({ kind: "UNIT_TEST", status: "READY", summary: "- Key idea of 1 Charge (p. 3)." });
    expect(a1.questions).toHaveLength(questionCountUnit(2));
    expect(a1.questions.every((q) => q.scope === "UNIT_TEST" && q.lessonId === null && q.pageRefs.every((p) => p >= 3 && p <= 6))).toBe(true);
    // The prompt carried only unit 1's written lessons and its practice questions to avoid.
    expect(writer.assessmentCalls[0].lessons.map((l) => l.title)).toEqual(["Charge", "Current"]);
    expect(await db.assessment.count({ where: { kind: "FINAL_EXAM" } })).toBe(0);

    await db.lesson.update({ where: { id: lessons[3].id }, data: { status: "READY", generatedAt: new Date(), content: content("Ohm's law") } });
    await queueReadyAssessments(c.id);
    await drain(); // unit 2's test, which then queues the final exam
    await drain();
    const final = await db.assessment.findFirstOrThrow({ where: { kind: "FINAL_EXAM" }, include: { questions: true } });
    expect(final).toMatchObject({ status: "READY", summary: null, unitId: null });
    expect(final.questions.length).toBe(10);
    expect(writer.assessmentCalls.at(-1)!.lessons).toHaveLength(4);
    expect(await db.usageEvent.count({ where: { feature: "ASSESSMENT" } })).toBe(3);
    expect(await queueReadyAssessments(c.id)).toBe(0); // nothing written twice
  });

  it("respects the course settings", async () => {
    const { course: c } = await course();
    await db.course.update({ where: { id: c.id }, data: { settings: { ...DEFAULT_SETTINGS, contentTypes: ["objectives", "multipleChoice", "unitSummaries"] } } });
    await queueReadyAssessments(c.id);
    await drain();
    const a = await db.assessment.findFirstOrThrow({ include: { questions: true } });
    expect(a.summary).toBeTruthy();
    expect(a.questions).toHaveLength(0); // unit tests are off
  });

  it("records failures and can regenerate; older courses can create them on request", async () => {
    const { user, course: c } = await course();
    expect(await createMissingAssessments(user.id, c.id)).toBe(1);
    writer.nextAssessment = new AiError("refused", "Claude declined.", "refusal", []);
    await expect(drain()).rejects.toBeInstanceOf(AiError);
    const a = await db.assessment.findFirstOrThrow();
    await db.assessment.update({ where: { id: a.id }, data: { status: "FAILED", error: "Claude declined." } });
    writer.nextAssessment = null;
    await regenerateAssessment(user.id, a.id);
    expect(queued).toHaveLength(1);
    await drain();
    expect((await db.assessment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("READY");
    const other = await createUser("Other");
    await expect(regenerateAssessment(other.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createMissingAssessments(other.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

const questionCountUnit = (lessons: number) => Math.min(12, Math.max(5, lessons * 3));

describe("taking a test", () => {
  async function readyTest() {
    const ctx = await course();
    await queueReadyAssessments(ctx.course.id);
    await drain();
    const a = await db.assessment.findFirstOrThrow({ include: { questions: { orderBy: { order: "asc" } } } });
    return { ...ctx, a };
  }

  it("shows questions without answers while taking it", async () => {
    const { user, a } = await readyTest();
    const t = await getTestQuestions(user.id, a.id);
    expect(t.questions).toHaveLength(a.questions.length);
    expect(Object.keys(t.questions[0]).sort()).toEqual(["choices", "id", "prompt", "topic", "type"]);
  });

  it("grades a whole test, saves it, and keeps history and best score", async () => {
    const { user, course: c, units, a } = await readyTest();
    const answers: Record<string, { choice?: number; response?: string }> = {};
    for (const q of a.questions) {
      if (q.type === "MULTIPLE_CHOICE") answers[q.id] = { choice: q.correctChoice! };
      else if (q.type === "SHORT_ANSWER") answers[q.id] = { response: "Something in my own words" }; // goes to (fake) Claude: partial
      // step-by-step left unanswered
    }
    const r = await submitTest(user.id, a.id, answers, { grader });
    expect(r.total).toBe(a.questions.length);
    const mcq = r.questions.filter((q) => q.type === "MULTIPLE_CHOICE");
    expect(mcq.every((q) => q.verdict === "CORRECT")).toBe(true);
    expect(r.questions.filter((q) => q.type === "SHORT_ANSWER").every((q) => q.verdict === "PARTIAL" && q.gradedBy === "CLAUDE")).toBe(true);
    expect(r.questions.filter((q) => q.type === "STEP_BY_STEP").every((q) => q.feedback === "Not answered." && q.score === 0)).toBe(true);
    expect(r.correct).toBe(mcq.length);
    expect(r.score).toBeGreaterThan(0);
    expect(r.questions[0]).toHaveProperty("answer"); // answers revealed with the results
    expect(grader.calls).toHaveLength(r.questions.filter((q) => q.type === "SHORT_ANSWER").length);
    // Grading for unit-test questions uses the pages each question cites.
    expect(grader.calls[0].pages.every((p) => p.pageNumber >= 3 && p.pageNumber <= 6)).toBe(true);

    expect(await db.questionAttempt.count({ where: { assessmentAttemptId: r.attemptId } })).toBe(a.questions.length);
    const view = await getUnitView(user.id, c.id, units[0].id);
    expect(view.attempts).toHaveLength(1);
    expect((await getCourseAssessments(user.id, c.id))[0].best).toBeCloseTo(r.score);
  });

  it("checks limits before grading and saves nothing if Claude fails", async () => {
    const { user, a } = await readyTest();
    const written = a.questions.filter((q) => q.type !== "MULTIPLE_CHOICE");
    const answers = Object.fromEntries(written.map((q) => [q.id, { response: "an answer that needs Claude" }]));
    await expect(submitTest(user.id, a.id, answers, { grader: null })).rejects.toMatchObject({ status: 503 });
    grader.next = new AiError("retryable", "Claude is busy right now.", "529", []);
    await expect(submitTest(user.id, a.id, answers, { grader })).rejects.toBeInstanceOf(StudyError);
    expect(await db.assessmentAttempt.count()).toBe(0);
    // Too many written answers for the hourly limit.
    await db.questionAttempt.createMany({ data: Array.from({ length: 59 }, () => ({ userId: user.id, courseId: a.courseId, topic: "t", response: "x", verdict: "INCORRECT" as const, correct: false, score: 0, feedback: "", gradedBy: "CLAUDE" as const })) });
    await expect(submitTest(user.id, a.id, answers, { grader: new FakeGrader() })).rejects.toMatchObject({ status: 429 });
  });

  it("is private", async () => {
    const { a } = await readyTest();
    const other = await createUser("Other");
    await expect(getTestQuestions(other.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitTest(other.id, a.id, {}, { grader })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("exports", () => {
  it("loads the course (written lessons, tests, cards) and builds an Anki deck", async () => {
    const { user, course: c } = await course();
    await queueReadyAssessments(c.id);
    await drain();
    const data = await getCourseExport(user.id, c.id);
    expect(data.title).toBe("Circuits");
    expect(data.units.map((u) => [u.title, u.lessons.map((l) => l.title)])).toEqual([
      ["1 Charge", ["Charge", "Current"]],
      ["2 Ohm", ["Resistance"]], // unwritten lesson left out
    ]);
    expect(data.units[0].test.length).toBeGreaterThan(0);
    expect(data.units[0].summary).toContain("Key idea");
    const apkg = buildApkg(await sqlJs(), data, new Date());
    expect(apkg.byteLength).toBeGreaterThan(1000);
    const other = await createUser("Other");
    await expect(getCourseExport(other.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
