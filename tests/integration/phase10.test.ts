import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUpload, RateLimitError } from "@/server/courses";
import { AiError } from "@/server/ai/writer";
import { GenerationError, regenerateLesson, startGeneration } from "@/server/generation/lessons";
import { runLessonJob } from "@/server/generation/run";
import { StudyError, submitAttempt } from "@/server/study";
import { askTutor, TutorError } from "@/server/tutor/chat";
import { assertAiBudget, getUsage, LimitError } from "@/server/limits";
import { rateLimit } from "@/server/rate-limit";
import { runMaintenance } from "@/server/maintenance";
import { track } from "@/server/analytics";
import { getAiSpend, getFailures, getFeatureUsage, getOverview, listUsers, retryLessons, setUserPlan } from "@/server/admin";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { DEFAULT_LIMITS } from "@/lib/usage/limits";
import { createUser, resetDb } from "../helpers/db";
import { FakeEmbedder, FakeGrader, FakeTutor, FakeWriter } from "../helpers/fake-claude";

const queued = vi.hoisted(() => [] as { payload: { kind: string; lessonId?: string }; priority: number }[]);
vi.mock("@/server/queue", async (orig) => ({
  ...(await orig<typeof import("@/server/queue")>()),
  enqueueGeneration: async (jobs: typeof queued) => void queued.push(...jobs),
  enqueueBookProcessing: async () => ({ id: "job" }),
  enqueueBookEmbedding: async () => {},
}));

/** A course whose lessons cover `pagesEach` pages each. */
async function course(opts: { lessons?: number; pagesEach?: number } = {}) {
  const user = await createUser();
  const n = opts.lessons ?? 3;
  const each = opts.pagesEach ?? 10;
  const book = await db.book.create({
    data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(5_000_000), status: "READY", pageCount: n * each },
  });
  await db.page.createMany({
    data: Array.from({ length: n * each }, (_, i) => ({ bookId: book.id, pageNumber: i + 1, text: `Page ${i + 1}. Electric current is the flow of charge. `.repeat(18), charCount: 900, width: 600, height: 800 })),
  });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Circuits", status: "ACTIVE", settings: DEFAULT_SETTINGS } });
  const unit = await db.unit.create({ data: { courseId: c.id, order: 0, title: "1 Basics" } });
  const lessons = [];
  for (let i = 0; i < n; i++) {
    lessons.push(
      await db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order: i, title: `Lesson ${i + 1}`, pageStart: i * each + 1, pageEnd: (i + 1) * each } }),
    );
  }
  return { user, book, course: c, lessons };
}

/** Pretend Claude has already cost this much this month. */
async function spend(userId: string, usd: number, extra: { feature?: "LESSON" | "GRADING"; lessonId?: string; createdAt?: Date } = {}) {
  await db.usageEvent.create({
    data: { userId, feature: extra.feature ?? "GRADING", lessonId: extra.lessonId, model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1, costMicroUsd: Math.round(usd * 1_000_000), createdAt: extra.createdAt },
  });
}

beforeEach(async () => {
  await resetDb();
  queued.length = 0;
});

describe("monthly usage limits", () => {
  it("counts this month's AI spend, pages (once per lesson), books and storage", async () => {
    const { user, lessons } = await course();
    await spend(user.id, 1.5, { feature: "LESSON", lessonId: lessons[0].id });
    await spend(user.id, 0.5, { feature: "LESSON", lessonId: lessons[0].id }); // rewritten: same pages
    await spend(user.id, 0.25, { feature: "LESSON", lessonId: lessons[1].id });
    await spend(user.id, 9, { createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) }); // an earlier month
    const { usage, limits, plan } = await getUsage(user.id);
    expect(plan).toBe("FREE");
    expect(limits).toEqual(DEFAULT_LIMITS.FREE);
    expect(usage.aiUsd).toBeCloseTo(2.25);
    expect(usage.pages).toBe(20);
    expect(usage.books).toBe(1);
    expect(usage.storageBytes).toBe(5_000_000);
  });

  it("won't start writing more pages than are left this month", async () => {
    const { user, course: c } = await course({ lessons: 3, pagesEach: 200 });
    await expect(startGeneration(user.id, c.id)).rejects.toThrow(GenerationError);
    await expect(startGeneration(user.id, c.id)).rejects.toThrow(/600 pages, but you have 500 of 500/);
    expect(queued).toHaveLength(0);
    expect(await db.lesson.count({ where: { courseId: c.id, status: "QUEUED" } })).toBe(0);
    // Pro has room.
    await setUserPlan("admin", user.id, "PRO");
    expect((await startGeneration(user.id, c.id)).queued).toBe(3);
  });

  it("won't start when the estimate is more than the allowance left", async () => {
    const { user, course: c } = await course({ lessons: 2, pagesEach: 5 });
    await spend(user.id, 4.99);
    await expect(startGeneration(user.id, c.id)).rejects.toThrow(/would cost about \$[\d.]+, but \$0.01/);
  });

  it("pauses everything that calls Claude once the allowance is used", async () => {
    const { user, course: c, lessons } = await course();
    await spend(user.id, DEFAULT_LIMITS.FREE.monthlyAiUsd);
    await expect(assertAiBudget(user.id)).rejects.toThrow(LimitError);

    // Regenerating a lesson
    await expect(regenerateLesson(user.id, lessons[0].id, { mode: "lesson" })).rejects.toThrow(/AI allowance/);
    // A lesson job already in the queue stops without retrying, and calls nothing
    const writer = new FakeWriter();
    const err = await runLessonJob({ lessonId: lessons[0].id }, { writer, model: "m", effort: "low" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).kind).toBe("limit");
    expect(writer.lessonCalls).toHaveLength(0);

    // Grading a written answer (multiple choice still works)
    const q = (type: "MULTIPLE_CHOICE" | "SHORT_ANSWER", extra: object) =>
      db.question.create({ data: { courseId: c.id, lessonId: lessons[0].id, type, order: 0, prompt: "Q", answer: "", explanation: "", topic: "T", ...extra } });
    const mcq = await q("MULTIPLE_CHOICE", { choices: ["A", "B"], correctChoice: 1, pageRefs: [] });
    const short = await q("SHORT_ANSWER", { answer: "The rate of flow of charge.", pageRefs: [2] });
    const grader = new FakeGrader();
    expect((await submitAttempt(user.id, mcq.id, { choice: 1 }, { grader })).correct).toBe(true);
    const graded = await submitAttempt(user.id, short.id, { response: "something else entirely" }, { grader }).catch((e) => e);
    expect(graded).toBeInstanceOf(StudyError);
    expect((graded as StudyError).status).toBe(429);
    expect(grader.calls).toHaveLength(0);

    // The tutor
    const asked = await askTutor(user.id, { courseId: c.id, question: "What is current?" }, { tutor: new FakeTutor(), embedder: new FakeEmbedder() }, () => {}, new AbortController().signal).catch((e) => e);
    expect(asked).toBeInstanceOf(TutorError);
    expect((asked as TutorError).message).toContain("AI allowance");
  });

  it("limits how many books can be kept", async () => {
    const user = await createUser();
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000); // outside the hourly upload limit
    await db.book.createMany({
      data: Array.from({ length: DEFAULT_LIMITS.FREE.maxBooks }, (_, i) => ({ userId: user.id, originalFilename: `${i}.pdf`, storageKey: `k${i}-${user.id}`, sizeBytes: BigInt(1000), createdAt: old })),
    });
    const input = { filename: "new.pdf", size: 1000, contentType: "application/pdf", rightsConfirmed: true };
    await expect(createUpload(user.id, input)).rejects.toThrow(RateLimitError);
    await expect(createUpload(user.id, input)).rejects.toThrow(/up to 10 books/);
    await db.book.deleteMany({ where: { userId: user.id, originalFilename: "0.pdf" } });
    await expect(createUpload(user.id, input)).resolves.toMatchObject({ bookId: expect.any(String) });
  });
});

describe("rate limiter (Redis)", () => {
  it("allows up to the limit per window, per subject", async () => {
    const rule = { name: `test-${Date.now()}`, max: 3, windowSeconds: 60 };
    const now = Date.now();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(rule, "alice", now));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    const blocked = results[3];
    expect(!blocked.ok && blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await rateLimit(rule, "bob", now)).ok).toBe(true);
    // The next window starts fresh.
    expect((await rateLimit(rule, "alice", now + 60_000)).ok).toBe(true);
  });
});

describe("maintenance and analytics", () => {
  it("removes abandoned uploads and expired rate-limit rows", async () => {
    const user = await createUser();
    const old = new Date(Date.now() - 30 * 60 * 60 * 1000);
    await db.book.create({ data: { userId: user.id, originalFilename: "gone.pdf", storageKey: "abandoned", sizeBytes: BigInt(1), createdAt: old } });
    await db.book.create({ data: { userId: user.id, originalFilename: "fresh.pdf", storageKey: "fresh", sizeBytes: BigInt(1) } });
    await db.rateLimit.create({ data: { key: "old", count: 1, lastRequest: BigInt(old.getTime()) } });
    await db.rateLimit.create({ data: { key: "new", count: 1, lastRequest: BigInt(Date.now()) } });
    const r = await runMaintenance();
    expect(r).toMatchObject({ uploads: 1, rateRows: 1 });
    expect((await db.book.findMany({ select: { originalFilename: true } })).map((b) => b.originalFilename)).toEqual(["fresh.pdf"]);
    expect(await db.rateLimit.count()).toBe(1);
  });

  it("records events without ever throwing, and keeps them (anonymous) when the account is deleted", async () => {
    const user = await createUser();
    await track("export_downloaded", user.id, { format: "apkg" });
    await expect(track("search_used", "no-such-user")).resolves.toBeUndefined(); // foreign key fails quietly
    await db.user.delete({ where: { id: user.id } });
    const events = await db.analyticsEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "export_downloaded", userId: null });
  });
});

describe("admin data", () => {
  it("summarizes users, spend, feature use and failures, and retries on the owner's behalf", async () => {
    const { user, course: c, lessons } = await course();
    const other = await createUser("Other");
    await spend(user.id, 1, { feature: "LESSON", lessonId: lessons[0].id });
    await spend(other.id, 0.5);
    await track("export_downloaded", user.id, { format: "md" });
    await track("export_downloaded", other.id, { format: "md" });
    await track("search_used", user.id);
    await db.lesson.update({ where: { id: lessons[1].id }, data: { status: "FAILED", error: "Claude was busy." } });
    await db.book.create({ data: { userId: other.id, originalFilename: "bad.pdf", storageKey: "bad", sizeBytes: BigInt(1), status: "FAILED", error: "Not a PDF." } });

    await db.studyDay.create({ data: { userId: user.id, day: new Date().toISOString().slice(0, 10), questionsAnswered: 2 } });
    const o = await getOverview();
    expect(o).toMatchObject({ users: 2, books: 2, failedBooks: 1, courses: 1, active7: 1, active30: 1 });
    expect(o.spendMonth).toBeCloseTo(1.5);

    const s = await getAiSpend();
    expect(s.topUsers.map((u) => u.email)).toEqual([user.email, other.email]);
    expect(s.byFeature.find((f) => f.feature === "LESSON")?.usd).toBeCloseTo(1);

    const usage = await getFeatureUsage();
    const count = (label: string) => usage.find((u) => u.label === label)?.count;
    expect(count("Sign-ups")).toBe(2);
    expect(count("Lessons written by Claude")).toBe(1);
    expect(count("Searches")).toBe(1);
    expect(count("Downloads (md)")).toBe(2);

    const f = await getFailures();
    expect(f.books).toMatchObject([{ filename: "bad.pdf", email: other.email, error: "Not a PDF." }]);
    expect(f.lessons).toMatchObject([{ courseId: c.id, failed: 1, error: "Claude was busy." }]);

    const users = await listUsers("other");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: other.email, plan: "FREE", budget: DEFAULT_LIMITS.FREE.monthlyAiUsd });
    expect(users[0].usdThisMonth).toBeCloseTo(0.5);

    const r = await retryLessons("admin", c.id);
    expect(r.queued).toBe(3); // the failed one and the two never written
    expect(await db.lesson.count({ where: { courseId: c.id, status: "QUEUED" } })).toBe(3);
  });
});
