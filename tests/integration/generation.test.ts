import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { AiError } from "@/server/ai/writer";
import {
  GenerationError,
  getGenerationProgress,
  getLessonView,
  regenerateAll,
  regenerateLesson,
  saveLessonEdits,
  startGeneration,
} from "@/server/generation/lessons";
import { markLessonFailed, runLessonJob, runQuestionsJob, type GenerationDeps } from "@/server/generation/run";
import { runAssessmentJob } from "@/server/generation/assessments";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeWriter, sampleDraft } from "../helpers/fake-claude";

// Record queued jobs instead of using Redis.
const queued = vi.hoisted(() => [] as { payload: { kind: string; lessonId: string; assessmentId?: string; force?: boolean; allowThin?: boolean }; priority: number }[]);
vi.mock("@/server/queue", () => ({
  enqueueGeneration: async (jobs: typeof queued) => void queued.push(...jobs),
  enqueueBookProcessing: async () => ({ id: "job" }),
}));

const prose = (n: number) => `Page ${n}. Electric current is the rate at which charge flows through a conductor. `.repeat(8);

/** An OUTLINE_DRAFT course: 10 pages, 2 units, 3 included lessons + 1 skipped. Page 7 is equation-heavy. */
async function course() {
  const user = await createUser();
  const book = await db.book.create({
    data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 10 },
  });
  await db.page.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      bookId: book.id,
      pageNumber: i + 1,
      text: i + 1 === 9 ? "Fig. 3" : i + 1 === 7 ? "V I R P I 2 R = Σ Ω" : prose(i + 1),
      charCount: 100,
      mathScore: i + 1 === 7 ? 0.6 : 0,
      width: 612,
      height: 792,
    })),
  });
  const c = await db.course.create({
    data: { userId: user.id, bookId: book.id, title: "Basic Circuits", status: "OUTLINE_DRAFT", settings: DEFAULT_SETTINGS },
  });
  const mk = async (order: number, title: string, lessons: [string, number, number, boolean?][]) =>
    db.unit.create({
      data: {
        courseId: c.id,
        order,
        title,
        lessons: { create: lessons.map(([t, s, e, skip], i) => ({ courseId: c.id, order: i, title: t, pageStart: s, pageEnd: e, skip: Boolean(skip) })) },
      },
      include: { lessons: { orderBy: { order: "asc" } } },
    });
  const u0 = await mk(0, "Front matter", [["Front matter", 1, 2, true]]);
  const u1 = await mk(1, "1 Charge", [["1.1 Basics", 3, 4], ["1.2 Current", 5, 6]]);
  const u2 = await mk(2, "2 Ohm's Law", [["2.1 Ohm's Law", 7, 8], ["2.2 Diagram", 9, 9]]);
  return { user, book, course: c, lessons: { front: u0.lessons[0], basics: u1.lessons[0], current: u1.lessons[1], ohm: u2.lessons[0], diagram: u2.lessons[1] } };
}

let writer: FakeWriter;
let deps: GenerationDeps;
const renderPage = vi.fn(async () => Buffer.from("png"));

beforeEach(async () => {
  await resetDb();
  queued.length = 0;
  writer = new FakeWriter();
  renderPage.mockClear();
  deps = { writer, model: "claude-sonnet-5-5", effort: "medium", renderPage };
});

/** Run every queued job the way the worker would. */
async function drain() {
  const outcomes: string[] = [];
  while (queued.length > 0) {
    const { payload } = queued.shift()!;
    // Unit tests / the final exam get queued once a unit's lessons are done (Phase 9); run them, but only report lesson outcomes.
    if (payload.kind === "assessment") {
      await runAssessmentJob({ assessmentId: payload.assessmentId! }, deps);
      continue;
    }
    outcomes.push(payload.kind === "questions" ? await runQuestionsJob(payload, deps) : await runLessonJob(payload, deps));
  }
  return outcomes;
}

describe("generating a course", () => {
  it("queues included lessons in course order, writes them, and finishes the course", async () => {
    const { user, course: c, lessons } = await course();
    const res = await startGeneration(user.id, c.id);
    expect(res).toEqual({ queued: 4, total: 4, batch: false });
    expect(queued.map((j) => j.payload.lessonId)).toEqual([lessons.basics.id, lessons.current.id, lessons.ohm.id, lessons.diagram.id]);
    expect(queued.map((j) => j.priority)).toEqual([10, 11, 12, 13]);
    expect((await db.course.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("GENERATING");

    const outcomes = await drain();
    expect(outcomes).toEqual(["generated", "generated", "generated", "flagged"]);
    expect((await db.course.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ACTIVE");

    const basics = await getLessonView(user.id, c.id, lessons.basics.id);
    expect(basics.lesson.status).toBe("READY");
    expect(basics.content?.objectives).toHaveLength(2);
    expect(basics.questions).toHaveLength(3); // the broken sample question was dropped
    expect(basics.questions.every((q) => q.pageRefs.every((p) => p >= 3 && p <= 4))).toBe(true);
    expect(basics.flashcards).toHaveLength(2);
    expect(basics.next?.id).toBe(lessons.current.id);
    expect(basics.prev).toBeNull();
    expect(basics.position).toEqual({ index: 1, total: 4 });
  });

  it("sends only the lesson's own pages to Claude, and the skipped lesson is never written", async () => {
    const { user, course: c } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const first = writer.lessonCalls[0];
    expect(first.pages.map((p) => p.pageNumber)).toEqual([3, 4]);
    expect(first.lessonTitle).toBe("1.1 Basics");
    expect(writer.lessonCalls.map((x) => x.lessonTitle)).not.toContain("Front matter");
  });

  it("re-reads equation-heavy pages from an image once, and uses that text", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(writer.repairCalls).toBe(1);
    const ohmCall = writer.lessonCalls.find((x) => x.lessonTitle === "2.1 Ohm's Law")!;
    expect(ohmCall.pages[0].repairedText).toContain("$$V = IR$$");
    // Regenerating doesn't re-read the page again: the repair is saved on the page.
    await regenerateLesson(user.id, lessons.ohm.id, { mode: "lesson" });
    await drain();
    expect(writer.repairCalls).toBe(1);
  });

  it("flags lessons without enough text instead of guessing, and 'Try anyway' overrides", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const diagram = await db.lesson.findUniqueOrThrow({ where: { id: lessons.diagram.id } });
    expect(diagram.status).toBe("FLAGGED");
    expect(diagram.flagReason).toMatch(/almost no text/);
    expect(writer.lessonCalls.map((x) => x.lessonTitle)).not.toContain("2.2 Diagram"); // no money spent on it

    await regenerateLesson(user.id, lessons.diagram.id, { mode: "lesson", allowThin: true });
    await drain();
    expect((await db.lesson.findUniqueOrThrow({ where: { id: lessons.diagram.id } })).status).toBe("READY");
  });

  it("flags a lesson when Claude says the pages aren't usable", async () => {
    const { user, course: c, lessons } = await course();
    writer.nextLesson = (i) => sampleDraft(i.pageStart, i.pageEnd, { sourceCheck: { usable: false, problem: "Only a garbled table." } });
    await startGeneration(user.id, c.id);
    await drain();
    const l = await db.lesson.findUniqueOrThrow({ where: { id: lessons.basics.id } });
    expect(l).toMatchObject({ status: "FLAGGED", flagReason: "Only a garbled table." });
  });

  it("records token usage and cost for every call", async () => {
    const { user, course: c } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const events = await db.usageEvent.findMany({ where: { courseId: c.id } });
    expect(events.filter((e) => e.feature === "LESSON")).toHaveLength(3);
    expect(events.filter((e) => e.feature === "PAGE_REPAIR")).toHaveLength(1);
    expect(events.filter((e) => e.feature === "FLASHCARDS").map((e) => e.model)).toEqual(Array(3).fill("claude-haiku-5-5"));
    const lesson = events.find((e) => e.feature === "LESSON")!;
    // 3000 in × $2 + 6000 out × $10 + 1500 cache reads × $0.10, per million tokens
    expect(lesson.costMicroUsd).toBe(66_150);
    expect(lesson.batch).toBe(false);
    // Flashcards on Haiku: 3000 in × $0.10 + 400 out × $0.50
    expect(events.find((e) => e.feature === "FLASHCARDS")!.costMicroUsd).toBe(500);
  });
});

describe("caching: nothing is regenerated unless asked", () => {
  it("starting generation again doesn't touch lessons that already have content", async () => {
    const { user, course: c } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const calls = writer.lessonCalls.length;
    const res = await startGeneration(user.id, c.id);
    expect(res.queued).toBe(0);
    expect(writer.lessonCalls.length).toBe(calls);
    expect((await db.course.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ACTIVE");
  });

  it("a job for an up-to-date lesson returns the cached content without calling Claude", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const before = writer.lessonCalls.length;
    expect(await runLessonJob({ lessonId: lessons.basics.id }, deps)).toBe("cached");
    expect(writer.lessonCalls.length).toBe(before);
  });

  it("regenerating on request replaces the content", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    writer.nextLesson = (i) => sampleDraft(i.pageStart, i.pageEnd, { objectives: ["A brand new objective."] });
    await regenerateLesson(user.id, lessons.basics.id, { mode: "lesson" });
    expect(queued[0]).toMatchObject({ priority: 1, payload: { force: true } });
    await drain();
    const v = await getLessonView(user.id, c.id, lessons.basics.id);
    expect(v.content?.objectives).toEqual(["A brand new objective."]);
  });

  it("regenerating only questions keeps the explanation and avoids repeating old questions", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const before = await getLessonView(user.id, c.id, lessons.basics.id);
    await regenerateLesson(user.id, lessons.basics.id, { mode: "questions" });
    await drain();
    const after = await getLessonView(user.id, c.id, lessons.basics.id);
    expect(after.content?.explanation).toBe(before.content?.explanation);
    expect(after.questions[0].prompt).toContain("(new 0)");
    expect(writer.questionCalls[0].avoid).toEqual(before.questions.map((q) => q.prompt));
  });

  it("'regenerate all' skips hand-edited lessons unless asked", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    await db.lesson.update({ where: { id: lessons.current.id }, data: { userEdited: true } });
    const res = await regenerateAll(user.id, c.id, { includeEdited: false });
    expect(res.queued).toBe(3); // basics, ohm, diagram (flagged)
    expect(queued.map((j) => j.payload.lessonId)).not.toContain(lessons.current.id);
  });
});

describe("hand edits", () => {
  const edit = (overrides: Record<string, unknown> = {}) => ({
    content: {
      objectives: ["Edited objective"],
      explanation: "My own explanation with $E = mc^2$.",
      workedExamples: [],
      keyTerms: [{ term: "Charge", definition: "A property of matter.", pageRefs: [3, 99] }],
    },
    questions: [
      { type: "MULTIPLE_CHOICE", prompt: "Pick B", choices: ["A", "B", "C"], correctChoice: 1, answer: "B", explanation: "It's B.", steps: [], pageRefs: [3], topic: "Letters" },
      { type: "SHORT_ANSWER", prompt: "Say hi", choices: ["ignored"], correctChoice: 0, answer: "hi", explanation: "", steps: ["ignored"], pageRefs: [], topic: "Greetings" },
    ],
    flashcards: [{ front: "F", back: "B", pageRefs: [4] }],
    ...overrides,
  });

  it("saves edits, cleans page refs, marks the lesson as edited, and caching keeps them", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    await saveLessonEdits(user.id, lessons.basics.id, edit());
    const v = await getLessonView(user.id, c.id, lessons.basics.id);
    expect(v.lesson.userEdited).toBe(true);
    expect(v.content?.explanation).toBe("My own explanation with $E = mc^2$.");
    expect(v.content?.keyTerms[0].pageRefs).toEqual([3]);
    expect(v.questions[1]).toMatchObject({ type: "SHORT_ANSWER", choices: [], correctChoice: null, steps: [], pageRefs: [3], userEdited: true });
    // A plain (non-forced) job keeps hand edits.
    expect(await runLessonJob({ lessonId: lessons.basics.id }, deps)).toBe("cached");
    expect((await getLessonView(user.id, c.id, lessons.basics.id)).content?.objectives).toEqual(["Edited objective"]);
  });

  it("rejects invalid edits with a helpful message", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const bad = edit({ questions: [{ type: "MULTIPLE_CHOICE", prompt: "Q", choices: ["A", "B"], correctChoice: 7, answer: "", explanation: "", steps: [], pageRefs: [], topic: "" }] });
    await expect(saveLessonEdits(user.id, lessons.basics.id, bad)).rejects.toThrow(/Pick which choice is correct/);
  });
});

describe("failures and privacy", () => {
  it("a failed lesson gets a message, and the course still finishes", async () => {
    const { user, course: c, lessons } = await course();
    writer.nextLesson = new AiError("refused", "Claude declined to write this lesson.");
    await startGeneration(user.id, c.id);
    const first = queued.shift()!;
    await expect(runLessonJob(first.payload, deps)).rejects.toBeInstanceOf(AiError);
    await markLessonFailed(first.payload.lessonId, "Claude declined to write this lesson.");
    await drain();
    const l = await db.lesson.findUniqueOrThrow({ where: { id: lessons.basics.id } });
    expect(l).toMatchObject({ status: "FAILED", error: "Claude declined to write this lesson." });
    const p = await getGenerationProgress(user.id, c.id);
    expect(p).toMatchObject({ courseStatus: "ACTIVE", total: 4, ready: 2, flagged: 1, failed: 1, done: 4 });
    // Generating again retries only the failed lesson.
    expect((await startGeneration(user.id, c.id)).queued).toBe(1);
  });

  it("refuses to start without a Claude key", async () => {
    const { user, course: c } = await course();
    vi.resetModules();
    vi.doMock("@/server/env", async (orig) => ({ ...(await orig<typeof import("@/server/env")>()), claudeEnabled: false }));
    const mod = await import("@/server/generation/lessons");
    await expect(mod.startGeneration(user.id, c.id)).rejects.toBeInstanceOf(mod.GenerationError);
    vi.doUnmock("@/server/env");
  });

  it("other users can't generate, view, edit or regenerate someone's lessons", async () => {
    const { user, course: c, lessons } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const intruder = await createUser("Intruder");
    await expect(startGeneration(intruder.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getLessonView(intruder.id, c.id, lessons.basics.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(regenerateLesson(intruder.id, lessons.basics.id, { mode: "lesson" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveLessonEdits(intruder.id, lessons.basics.id, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(getGenerationProgress(intruder.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("explains why questions can't be regenerated before the lesson exists", async () => {
    const { user, lessons } = await course();
    await expect(regenerateLesson(user.id, lessons.basics.id, { mode: "questions" })).rejects.toBeInstanceOf(GenerationError);
  });
});
