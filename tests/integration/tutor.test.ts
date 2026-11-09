import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { AiError } from "@/server/ai/writer";
import { booksNeedingEmbeddings, embedBook, embeddingProgress } from "@/server/embeddings/book";
import { retrievePassages } from "@/server/tutor/retrieve";
import { askTutor, deleteThread, getThread, listThreads, TutorError, tutorStatus, type TutorEvent } from "@/server/tutor/chat";
import { createUser, resetDb } from "../helpers/db";
import { FakeEmbedder, FakeTutor, fakeVector } from "../helpers/fake-claude";

vi.mock("@/server/queue", () => ({ enqueueGeneration: async () => {}, enqueueBookProcessing: async () => ({ id: "job" }), enqueueBookEmbedding: async () => {} }));

const TEXTS = [
  [2, "Electric charge comes in two kinds, positive and negative. Like charges repel."],
  [5, "Electric current is the rate of flow of charge through a conductor, measured in amperes."],
  [7, "Kirchhoff's junction rule: the total current entering a junction equals the current leaving it."],
  [9, "Ohm's law: voltage equals current times resistance, V = IR."],
  [11, "Capacitors store energy in an electric field between two plates."],
] as const;

async function course() {
  const user = await createUser();
  const book = await db.book.create({ data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 12 } });
  await db.chunk.createMany({ data: TEXTS.map(([page, text], i) => ({ bookId: book.id, ordinal: i, pageStart: page, pageEnd: page, text, tokenCount: 30 })) });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Circuits", status: "ACTIVE" } });
  const unit = await db.unit.create({ data: { courseId: c.id, order: 0, title: "1 Basics" } });
  const lesson = await db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order: 0, title: "Kirchhoff's rules", pageStart: 7, pageEnd: 8 } });
  return { user, book, course: c, lesson };
}

let embedder: FakeEmbedder;
let tutor: FakeTutor;
beforeEach(async () => {
  await resetDb();
  embedder = new FakeEmbedder();
  tutor = new FakeTutor();
});

async function ask(userId: string, input: Parameters<typeof askTutor>[1], signal = new AbortController().signal) {
  const events: TutorEvent[] = [];
  await askTutor(userId, input, { tutor, embedder }, (e) => events.push(e), signal);
  return events;
}

describe("embedding books", () => {
  it("embeds every passage, resumes, and re-embeds after a model change", async () => {
    const { book } = await course();
    expect(await booksNeedingEmbeddings()).toEqual([book.id]);
    expect(await embedBook(book.id, embedder, { batch: 2 })).toBe(5);
    expect(await embeddingProgress(book.id)).toBe(1);
    expect(await booksNeedingEmbeddings()).toEqual([]);
    expect(await embedBook(book.id, embedder)).toBe(0); // nothing left
    const [{ dims }] = await db.$queryRaw<{ dims: number }[]>`SELECT vector_dims(embedding) AS dims FROM "Chunk" LIMIT 1`;
    expect(dims).toBe(384);
    expect(await booksNeedingEmbeddings("some-new-model")).toEqual([book.id]);
  });
});

describe("retrieval", () => {
  it("combines keyword and meaning search", async () => {
    const { book } = await course();
    await embedBook(book.id, embedder);
    embedder.override = fakeVector(TEXTS[2][1]); // a strong meaning match for the junction passage
    const r = await retrievePassages({ bookId: book.id, question: "What is the junction rule?", embedder });
    expect(r.mode).toBe("hybrid");
    expect(r.passages.map((p) => p.pageStart)).toContain(7); // passages come back in book order
    expect(r.confidence).toBe("high");
  });

  it("finds a passage by meaning alone when no words match", async () => {
    const { book } = await course();
    await embedBook(book.id, embedder);
    embedder.override = fakeVector(TEXTS[4][1]); // pretend "where is energy kept?" means the capacitor passage
    const r = await retrievePassages({ bookId: book.id, question: "zzz qqq", embedder });
    expect(r.passages.map((p) => p.pageStart)).toContain(11);
  });

  it("falls back to keyword search when the question can't be embedded", async () => {
    const { book } = await course();
    embedder.override = null;
    const r = await retrievePassages({ bookId: book.id, question: "Ohm's law resistance", embedder });
    expect(r.mode).toBe("keyword");
    expect(r.passages.map((p) => p.pageStart)).toContain(9);
    expect(r.confidence).toBe("low");
  });

  it("only searches the given book", async () => {
    const a = await course();
    const b = await course();
    await embedBook(b.book.id, embedder);
    const r = await retrievePassages({ bookId: a.book.id, question: "current junction", embedder });
    const ids = new Set((await db.chunk.findMany({ where: { bookId: a.book.id }, select: { id: true } })).map((c) => c.id));
    expect(r.passages.length).toBeGreaterThan(0);
    expect(r.passages.every((p) => ids.has(p.id))).toBe(true);
  });
});

describe("asking the tutor", () => {
  it("streams an answer, keeps only valid citations, and saves the conversation", async () => {
    const { user, course: c } = await course();
    const events = await ask(user.id, { courseId: c.id, question: "What is electric current?" });
    expect(events[0]).toMatchObject({ type: "meta", threadTitle: "What is electric current?" });
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(3);
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: "done", status: "DONE", citedPages: [5], notInBook: false });
    expect((done as { content: string }).content).toBe("Current is the rate of flow of charge [p. 5]. Also see.");
    const meta = events[0] as Extract<TutorEvent, { type: "meta" }>;
    const thread = await getThread(user.id, meta.threadId);
    expect(thread.messages.map((m) => [m.role, m.status])).toEqual([
      ["USER", "DONE"],
      ["ASSISTANT", "DONE"],
    ]);
    expect(await db.usageEvent.findFirstOrThrow()).toMatchObject({ feature: "TUTOR", courseId: c.id, model: "claude-opus-5-5" });
    // The prompt carried the passages and the question.
    const last = tutor.calls[0].at(-1)!.content;
    expect(last).toContain('<passage pages="5">');
    expect(last).toContain("What is electric current?");
  });

  it("sends earlier turns as history in a follow-up", async () => {
    const { user, course: c } = await course();
    const first = await ask(user.id, { courseId: c.id, question: "What is current?" });
    const threadId = (first[0] as { threadId: string }).threadId;
    await ask(user.id, { courseId: c.id, threadId, question: "And how is it measured?" });
    const sent = tutor.calls[1];
    expect(sent.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(sent[0].content).toBe("What is current?");
    expect((await listThreads(user.id, c.id))).toHaveLength(1);
  });

  it("marks 'not in the book' answers", async () => {
    const { user, course: c } = await course();
    tutor.reply = "The book doesn't cover this. The closest topic is Ohm's law [p. 9].";
    const done = (await ask(user.id, { courseId: c.id, question: "Explain quantum tunnelling" })).at(-1);
    expect(done).toMatchObject({ type: "done", notInBook: true });
  });

  it("asked from a lesson, prefers that lesson's pages and remembers it", async () => {
    const { user, course: c, lesson } = await course();
    const events = await ask(user.id, { courseId: c.id, lessonId: lesson.id, question: "current" });
    const meta = events[0] as Extract<TutorEvent, { type: "meta" }>;
    expect(meta.sources.map((s) => s.pageStart)).toContain(7);
    expect(tutor.calls[0].at(-1)!.content).toContain(`studying the lesson "Kirchhoff's rules"`);
    expect((await getThread(user.id, meta.threadId)).lessonId).toBe(lesson.id);
  });

  it("saves a stopped answer as STOPPED with what was written", async () => {
    const { user, course: c } = await course();
    const ctrl = new AbortController();
    const events: TutorEvent[] = [];
    await askTutor(user.id, { courseId: c.id, question: "What is current?" }, { tutor, embedder }, (e) => {
      events.push(e);
      if (e.type === "delta" && events.filter((x) => x.type === "delta").length === 2) ctrl.abort();
    }, ctrl.signal);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "STOPPED" });
    const msg = await db.tutorMessage.findFirstOrThrow({ where: { role: "ASSISTANT" } });
    expect(msg.status).toBe("STOPPED");
    expect(msg.content.length).toBeGreaterThan(0);
    expect(await db.usageEvent.count()).toBe(1);
  });

  it("reports Claude errors, keeps the question, and records what was billed", async () => {
    const { user, course: c } = await course();
    tutor.fail = new AiError("retryable", "Claude is busy right now. Please ask again in a minute.", "529", [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 100, outputTokens: 0 } }]);
    expect((await ask(user.id, { courseId: c.id, question: "What is current?" })).at(-1)).toEqual({ type: "error", message: "Claude is busy right now. Please ask again in a minute." });
    expect(await db.tutorMessage.findFirstOrThrow({ where: { role: "ASSISTANT" } })).toMatchObject({ status: "ERROR" });
    expect(await db.usageEvent.count()).toBe(1);
  });

  it("validates, limits, and needs a ready book and a tutor", async () => {
    const { user, course: c, book } = await course();
    await expect(ask(user.id, { courseId: c.id, question: "   " })).rejects.toBeInstanceOf(TutorError);
    await expect(ask(user.id, { courseId: c.id, question: "x".repeat(4001) })).rejects.toBeInstanceOf(TutorError);
    await expect(askTutor(user.id, { courseId: c.id, question: "hi" }, { tutor: null, embedder }, () => {}, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
    const t = await db.tutorThread.create({ data: { userId: user.id, courseId: c.id, title: "t" } });
    await db.tutorMessage.createMany({ data: Array.from({ length: 30 }, () => ({ threadId: t.id, role: "USER" as const, content: "q" })) });
    await expect(ask(user.id, { courseId: c.id, question: "one more" })).rejects.toMatchObject({ status: 429 });
    await db.book.update({ where: { id: book.id }, data: { status: "PROCESSING" } });
    await expect(ask(user.id, { courseId: c.id, question: "hi" })).rejects.toMatchObject({ status: 409 });
    expect((await tutorStatus(user.id, c.id)).ready).toBe(false);
  });

  it("is private", async () => {
    const a = await course();
    const first = await ask(a.user.id, { courseId: a.course.id, question: "What is current?" });
    const threadId = (first[0] as { threadId: string }).threadId;
    const other = await createUser("Other");
    const b = await course();
    await expect(ask(other.id, { courseId: a.course.id, question: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(ask(b.user.id, { courseId: b.course.id, threadId, question: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getThread(other.id, threadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteThread(other.id, threadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listThreads(other.id, a.course.id)).rejects.toBeInstanceOf(NotFoundError);
    // A lesson from another course is ignored, not attached.
    const events = await ask(b.user.id, { courseId: b.course.id, lessonId: a.lesson.id, question: "current" });
    expect((await getThread(b.user.id, (events[0] as { threadId: string }).threadId)).lessonId).toBeNull();
    await deleteThread(a.user.id, threadId);
    expect(await db.tutorMessage.count({ where: { threadId } })).toBe(0);
  });
});
