import { beforeEach, describe, expect, it, vi } from "vitest";

// This file tests whole-course generation through the Message Batches API.
vi.hoisted(() => {
  process.env.CLAUDE_BATCH_GENERATION = "true";
});

import { db } from "@/server/db";
import { AiError } from "@/server/ai/writer";
import {
  InstantBatchRunner,
  type BatchResult,
  type BatchRunner,
} from "@/server/ai/batch";
import {
  getGenerationProgress,
  startGeneration,
} from "@/server/generation/lessons";
import {
  runFlashcardsJob,
  runLessonJob,
  type GenerationDeps,
} from "@/server/generation/run";
import { runAssessmentJob } from "@/server/generation/assessments";
import {
  pollBatch,
  submitAssessmentBatch,
  submitLessonBatch,
  type BatchDeps,
} from "@/server/generation/batch";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeWriter } from "../helpers/fake-claude";

type Queued = {
  payload: Record<string, unknown> & { kind: string };
  priority: number;
  delayMs?: number;
};
const queued = vi.hoisted(() => [] as Queued[]);
vi.mock("@/server/queue", () => ({
  enqueueGeneration: async (jobs: Queued[]) => void queued.push(...jobs),
  enqueueBookProcessing: async () => ({ id: "job" }),
}));

const prose = (n: number) =>
  `Page ${n}. Electric current is the rate at which charge flows through a conductor. `.repeat(
    8,
  );

/** A course ready to generate: 2 units, 3 lessons; page 7 is equation-heavy (re-read from its image). */
async function course() {
  const user = await createUser();
  const book = await db.book.create({
    data: {
      userId: user.id,
      originalFilename: "c.pdf",
      storageKey: `k-${Math.random()}`,
      sizeBytes: BigInt(1),
      status: "READY",
      pageCount: 8,
    },
  });
  await db.page.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({
      bookId: book.id,
      pageNumber: i + 1,
      text: i + 1 === 7 ? "V I R P I 2 R = Σ Ω" : prose(i + 1),
      charCount: 100,
      mathScore: i + 1 === 7 ? 0.6 : 0,
      width: 612,
      height: 792,
    })),
  });
  const c = await db.course.create({
    data: {
      userId: user.id,
      bookId: book.id,
      title: "Basic Circuits",
      status: "OUTLINE_DRAFT",
      settings: DEFAULT_SETTINGS,
    },
  });
  const unit = (
    order: number,
    title: string,
    lessons: [string, number, number][],
  ) =>
    db.unit.create({
      data: {
        courseId: c.id,
        order,
        title,
        lessons: {
          create: lessons.map(([t, s, e], i) => ({
            courseId: c.id,
            order: i,
            title: t,
            pageStart: s,
            pageEnd: e,
          })),
        },
      },
      include: { lessons: { orderBy: { order: "asc" } } },
    });
  const u1 = await unit(0, "1 Charge", [
    ["1.1 Basics", 3, 4],
    ["1.2 Current", 5, 6],
  ]);
  const u2 = await unit(1, "2 Ohm's Law", [["2.1 Ohm's Law", 7, 8]]);
  return { user, course: c, lessons: [...u1.lessons, ...u2.lessons] };
}

let writer: FakeWriter;
let runner: BatchRunner;
let deps: BatchDeps;

beforeEach(async () => {
  await resetDb();
  queued.length = 0;
  writer = new FakeWriter();
  runner = new InstantBatchRunner(writer);
  deps = {
    writer,
    model: "claude-sonnet-5-5",
    effort: "medium",
    renderPage: async () => Buffer.from("png"),
    runner,
  };
});

/** Run queued jobs the way the worker would; returns the kinds that ran. */
async function drain(d: BatchDeps = deps) {
  const ran: string[] = [];
  while (queued.length > 0) {
    const { payload: p } = queued.shift()!;
    ran.push(p.kind);
    const direct: GenerationDeps = d;
    if (p.kind === "lesson-batch") await submitLessonBatch(p as never, d);
    else if (p.kind === "assessment-batch")
      await submitAssessmentBatch(p as never, d);
    else if (p.kind === "batch-poll") {
      if ((await pollBatch(p as never, d)) === "waiting") return ran; // still with Claude
    } else if (p.kind === "assessment")
      await runAssessmentJob(p as never, direct);
    else if (p.kind === "flashcards")
      await runFlashcardsJob(p as never, direct);
    else await runLessonJob(p as never, direct);
  }
  return ran;
}

describe("generating a course through the Batch API", () => {
  it("sends every lesson and its flashcards as one batch, saves the results, then batches the unit tests and exam", async () => {
    const { user, course: c, lessons } = await course();
    const res = await startGeneration(user.id, c.id);
    expect(res).toMatchObject({ queued: 3, batch: true });
    expect(queued).toEqual([
      {
        payload: {
          kind: "lesson-batch",
          courseId: c.id,
          lessonIds: lessons.map((l) => l.id),
        },
        priority: 10,
      },
    ]);

    const ran = await drain();
    expect(ran.filter((k) => k === "lesson-batch")).toHaveLength(1);
    expect(
      ran.filter((k) => k === "assessment-batch").length,
    ).toBeGreaterThanOrEqual(1);
    expect(ran).not.toContain("lesson"); // nothing had to be redone one at a time

    const batches = (runner as InstantBatchRunner).submitted;
    expect(batches[0].map((i) => i.customId)).toEqual(
      lessons.flatMap((l) => [`lesson-${l.id}`, `cards-${l.id}`]),
    );
    const saved = await db.lesson.findMany({
      where: { courseId: c.id },
      include: { flashcards: true, questions: true },
    });
    expect(
      saved.every(
        (l) =>
          l.status === "READY" &&
          l.content &&
          l.flashcards.length === 2 &&
          l.questions.length > 0,
      ),
    ).toBe(true);
    expect(
      (await db.course.findUniqueOrThrow({ where: { id: c.id } })).status,
    ).toBe("ACTIVE");
    const tests = await db.assessment.findMany({ where: { courseId: c.id } });
    expect(tests.map((t) => [t.kind, t.status]).sort()).toEqual([
      ["FINAL_EXAM", "READY"],
      ["UNIT_TEST", "READY"],
      ["UNIT_TEST", "READY"],
    ]);
    expect(
      await db.generationBatch.count({
        where: { courseId: c.id, status: "PROCESSED" },
      }),
    ).toBe(batches.length);
  });

  it("bills batched calls at half price; page reading is still a direct call", async () => {
    const { user, course: c } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const events = await db.usageEvent.findMany({ where: { courseId: c.id } });
    const lesson = events.find((e) => e.feature === "LESSON")!;
    // (3000 in × $2 + 6000 out × $10 + 1500 cache reads × $0.10) / 2, per million tokens
    expect(lesson).toMatchObject({ batch: true, costMicroUsd: 33_075 });
    expect(
      events
        .filter((e) => e.feature === "FLASHCARDS")
        .every((e) => e.batch && e.model === "claude-haiku-5-5"),
    ).toBe(true);
    expect(
      events.filter((e) => e.feature === "ASSESSMENT").every((e) => e.batch),
    ).toBe(true);
    expect(events.filter((e) => e.feature === "PAGE_REPAIR")).toEqual([
      expect.objectContaining({ batch: false }),
    ]);
  });

  it("shows the course as waiting in a batch until Claude finishes it", async () => {
    const { user, course: c } = await course();
    const slow: BatchRunner = {
      ...runner,
      firstPollMs: 1,
      submit: (i) => runner.submit(i),
      isDone: async () => false,
      results: () => runner.results("", () => null),
    };
    await startGeneration(user.id, c.id);
    expect(await drain({ ...deps, runner: slow })).toEqual([
      "lesson-batch",
      "batch-poll",
    ]);
    const progress = await getGenerationProgress(user.id, c.id);
    expect(progress.batch).not.toBeNull();
    expect(progress.ready).toBe(0);
    expect(
      await db.lesson.count({ where: { courseId: c.id, status: "QUEUED" } }),
    ).toBe(3);
  });

  it("redoes a declined lesson directly (which tries the fallback model) and marks a too-long one failed", async () => {
    const { user, course: c, lessons } = await course();
    let calls = 0;
    const realWrite = writer.writeLesson.bind(writer);
    writer.writeLesson = async (input) => {
      calls += 1;
      if (calls === 1)
        throw new AiError("refused", "Claude declined.", "refusal");
      if (calls === 2)
        throw new AiError(
          "too_long",
          "This lesson is too long to write in one go.",
          "max_tokens",
        );
      return realWrite(input);
    };
    await startGeneration(user.id, c.id);
    const ran = await drain();
    expect(ran.filter((k) => k === "lesson")).toHaveLength(1); // only the declined one
    const byId = new Map(
      (await db.lesson.findMany({ where: { courseId: c.id } })).map((l) => [
        l.id,
        l,
      ]),
    );
    expect(byId.get(lessons[0].id)).toMatchObject({ status: "READY" });
    expect(byId.get(lessons[1].id)).toMatchObject({
      status: "FAILED",
      error: "This lesson is too long to write in one go.",
    });
    expect(byId.get(lessons[2].id)).toMatchObject({ status: "READY" });
  });

  it("redoes requests that errored or expired in the batch", async () => {
    const { user, course: c, lessons } = await course();
    const flaky: BatchRunner = {
      firstPollMs: 1,
      submit: (items) => runner.submit(items),
      isDone: async () => true,
      async *results(id, kindOf) {
        for await (const r of runner.results(id, kindOf)) {
          yield r.customId === `lesson-${lessons[2].id}`
            ? ({
                customId: r.customId,
                ok: false,
                error: null,
                detail: "expired",
                calls: [],
              } satisfies BatchResult)
            : r;
        }
      },
    };
    await startGeneration(user.id, c.id);
    const ran = await drain({ ...deps, runner: flaky });
    expect(ran.filter((k) => k === "lesson")).toHaveLength(1);
    expect(
      await db.lesson.count({ where: { courseId: c.id, status: "READY" } }),
    ).toBe(3);
  });

  it("never saves or bills a result twice when a check is interrupted and retried", async () => {
    const { user, course: c } = await course();
    let fail = true;
    const stored = new Map<string, BatchResult[]>();
    const interrupted: BatchRunner = {
      firstPollMs: 1,
      submit: async (items) => {
        const id = await runner.submit(items);
        const all: BatchResult[] = [];
        for await (const r of runner.results(id, () => null)) all.push(r);
        stored.set(id, all);
        return id;
      },
      isDone: async () => true,
      async *results(id) {
        for (const [i, r] of stored.get(id)!.entries()) {
          if (fail && i === 2) {
            fail = false;
            throw new Error("connection reset");
          }
          yield r;
        }
      },
    };
    await startGeneration(user.id, c.id);
    queued.length = 0;
    await submitLessonBatch(
      {
        courseId: c.id,
        lessonIds: (
          await db.lesson.findMany({
            where: { courseId: c.id },
            orderBy: { pageStart: "asc" },
          })
        ).map((l) => l.id),
      },
      { ...deps, runner: interrupted },
    );
    const batch = await db.generationBatch.findFirstOrThrow({
      where: { courseId: c.id },
    });
    await expect(
      pollBatch({ batchId: batch.id }, { ...deps, runner: interrupted }),
    ).rejects.toThrow("connection reset");
    expect(
      (await db.generationBatch.findUniqueOrThrow({ where: { id: batch.id } }))
        .processedIds,
    ).toHaveLength(2);
    expect(
      await pollBatch({ batchId: batch.id }, { ...deps, runner: interrupted }),
    ).toBe("processed");
    // 3 lessons + 3 flashcard sets, each billed once (plus the page re-read).
    expect(
      await db.usageEvent.count({
        where: { courseId: c.id, feature: { in: ["LESSON", "FLASHCARDS"] } },
      }),
    ).toBe(6);
  });

  it("stops waiting on a batch that's far past Claude's 24-hour limit and writes its lessons directly", async () => {
    const { user, course: c } = await course();
    const stuck: BatchRunner = {
      firstPollMs: 1,
      submit: (i) => runner.submit(i),
      isDone: async () => false,
      results: () => runner.results("", () => null),
    };
    await startGeneration(user.id, c.id);
    await drain({ ...deps, runner: stuck });
    await db.generationBatch.updateMany({
      where: { courseId: c.id },
      data: { createdAt: new Date(Date.now() - 27 * 3600_000) },
    });
    const batch = await db.generationBatch.findFirstOrThrow({
      where: { courseId: c.id },
    });
    queued.length = 0;
    expect(
      await pollBatch({ batchId: batch.id }, { ...deps, runner: stuck }),
    ).toBe("processed");
    expect(
      (await db.generationBatch.findUniqueOrThrow({ where: { id: batch.id } }))
        .status,
    ).toBe("FAILED");
    expect(queued.map((q) => q.payload.kind).sort()).toEqual([
      "flashcards",
      "flashcards",
      "flashcards",
      "lesson",
      "lesson",
      "lesson",
    ]);
  });

  it("doesn't send lessons that are already written and up to date", async () => {
    const { user, course: c } = await course();
    await startGeneration(user.id, c.id);
    await drain();
    const before = (runner as InstantBatchRunner).submitted.length;
    await db.course.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    expect((await startGeneration(user.id, c.id)).queued).toBe(0);
    await drain();
    expect((runner as InstantBatchRunner).submitted.length).toBe(before);
  });
});

describe("flashcards on their own request", () => {
  it("keeps the lesson when its flashcards can't be written, and retries only the cards when Claude was busy", async () => {
    const { course: c, lessons } = await course();
    await db.course.update({
      where: { id: c.id },
      data: { status: "GENERATING" },
    });
    const direct: GenerationDeps = deps;
    writer.nextFlashcards = new AiError(
      "retryable",
      "Claude is busy right now.",
    );
    await expect(
      runLessonJob({ lessonId: lessons[0].id }, direct),
    ).rejects.toMatchObject({ kind: "retryable" });
    expect(
      await db.lesson.findUniqueOrThrow({ where: { id: lessons[0].id } }),
    ).toMatchObject({ generatedAt: expect.any(Date) });
    // The retry finds the lesson up to date and only writes the cards.
    expect(await runLessonJob({ lessonId: lessons[0].id }, direct)).toBe(
      "cached",
    );
    expect(writer.lessonCalls).toHaveLength(1);
    expect(writer.flashcardCalls).toHaveLength(2);
    expect(
      await db.flashcard.count({ where: { lessonId: lessons[0].id } }),
    ).toBe(2);

    writer.nextFlashcards = new AiError("refused", "Claude declined.");
    expect(await runLessonJob({ lessonId: lessons[1].id }, direct)).toBe(
      "generated",
    );
    expect(
      await db.lesson.findUniqueOrThrow({ where: { id: lessons[1].id } }),
    ).toMatchObject({ status: "READY" });
    expect(
      await db.flashcard.count({ where: { lessonId: lessons[1].id } }),
    ).toBe(0);
  });
});
