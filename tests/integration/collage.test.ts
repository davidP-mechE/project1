import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { OcrPool } from "@/server/processing/ocr";
import { processBook } from "@/server/processing/process-book";
import { runProcessBookJob } from "@/server/processing/run-job";
import { NotFoundError } from "@/server/courses";
import { addDecks, CollageError, completeDecks, createCollage, getDecks, removeFailedDeck, retryDecks } from "@/server/collage";
import { runLessonJob } from "@/server/generation/run";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeWriter } from "../helpers/fake-claude";
import { LECTURE, makePptx, makeSlidesPdf, type TestSlide } from "../helpers/slides";

const processing = vi.hoisted(() => [] as string[]);
vi.mock("@/server/queue", async (orig) => ({
  ...(await orig<typeof import("@/server/queue")>()),
  enqueueGeneration: async () => {},
  enqueueBookProcessing: async (input: { bookId: string }) => (processing.push(input.bookId), { id: "job" }),
  enqueueBookEmbedding: async () => {},
}));

const ocr = new OcrPool(1);
afterAll(() => ocr.close());
beforeEach(async () => {
  await resetDb();
  processing.length = 0;
});

const WEEK2: TestSlide[] = [
  { title: "Week 2: Circuits in practice" },
  { title: "Series circuits", body: ["Resistances add: R = R1 + R2 + R3", "The same current flows through every part of a series circuit"] },
  { title: "Parallel circuits", body: ["Voltages are equal across parallel branches", "Currents in the branches add up to the total current"], notes: "Draw the two branches on the board." },
  { title: "Questions?" },
];
const BROKEN_PDF = Buffer.from("%PDF-1.7\nthis is not really a pdf at all\n%%EOF\n");

type Upload = { name: string; bytes: Uint8Array | Buffer };
const file = (u: Upload) => ({ filename: u.name, size: u.bytes.length, contentType: "" });

/** Upload the decks the way the browser does: ask for URLs, put each file, then say it's done. */
async function upload(uploads: { deckId: string; filename: string }[], files: Upload[]) {
  for (const u of uploads) {
    const f = files.find((x) => x.name === u.filename)!;
    const deck = await db.deck.findUniqueOrThrow({ where: { id: u.deckId } });
    await storage.put(deck.storageKey, Buffer.from(f.bytes), "application/octet-stream");
  }
}

async function outline(courseId: string) {
  const units = await db.unit.findMany({ where: { courseId }, orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } });
  return units.map((u) => `${u.title}: ${u.lessons.map((l) => `${l.title}${l.skip ? " (skip)" : ""} ${l.pageStart}-${l.pageEnd}`).join(", ")}`);
}

async function newCollage(files: Upload[], title = "Physics 101") {
  const user = await createUser();
  const { courseId, uploads } = await createCollage(user.id, { title, files: files.map(file), rightsConfirmed: true });
  await upload(uploads, files);
  const done = await completeDecks(user.id, courseId);
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, include: { book: true } });
  return { user, course, done };
}

describe("slide collages", () => {
  it("merges several decks (PDF and PowerPoint) into one course, a unit per deck in upload order", async () => {
    const files = [
      { name: "Week_1-Charge.pdf", bytes: await makeSlidesPdf(LECTURE) },
      { name: "Week 2.pptx", bytes: makePptx(WEEK2) },
    ];
    const { course, done } = await newCollage(files);
    expect(done).toEqual({ ok: true, courseId: course.id, failed: [] });
    expect(course.status).toBe("PROCESSING");
    expect(processing).toEqual([course.bookId]);

    await processBook(course.bookId, { ocr });
    const book = await db.book.findUniqueOrThrow({ where: { id: course.bookId } });
    expect(book).toMatchObject({ status: "READY", pageCount: 15, originalFilename: "2 slide decks" });
    expect(await db.course.findUniqueOrThrow({ where: { id: course.id }, select: { status: true, outlineSource: true } })).toEqual({ status: "OUTLINE_DRAFT", outlineSource: "SLIDES" });
    expect(await outline(course.id)).toEqual([
      "Week 1 Charge: Title and agenda (skip) 1-2, Charge and current 3-6, Ohm's law 7-10, Closing slides (skip) 11-11",
      "Week 2: Title and agenda (skip) 12-12, Series circuits 13-14, Closing slides (skip) 15-15",
    ]);
    // The PowerPoint deck's own text and speaker notes are kept.
    const p14 = await db.page.findFirstOrThrow({ where: { bookId: book.id, pageNumber: 14 } });
    expect(p14.text).toContain("Speaker notes: Draw the two branches on the board.");
    const decks = await getDecks(course.userId, course.id);
    expect(decks!.decks.map((d) => [d.title, d.status, d.pageStart, d.pageEnd])).toEqual([
      ["Week 1 Charge", "READY", 1, 11],
      ["Week 2", "READY", 12, 15],
    ]);
  });

  it("adds decks to a course in use without touching its lessons, and turns a one-deck course into a collage", async () => {
    // A normal one-deck slides course, already studied.
    const user = await createUser();
    const one = await createCollage(user.id, { title: "Circuits", files: [file({ name: "lecture1.pdf", bytes: await makeSlidesPdf(LECTURE) })], rightsConfirmed: true });
    await upload(one.uploads, [{ name: "lecture1.pdf", bytes: await makeSlidesPdf(LECTURE) }]);
    await completeDecks(user.id, one.courseId);
    const course = await db.course.findUniqueOrThrow({ where: { id: one.courseId } });
    await processBook(course.bookId, { ocr });
    await db.course.update({ where: { id: course.id }, data: { status: "ACTIVE", settings: DEFAULT_SETTINGS } });
    const ohm = await db.lesson.findFirstOrThrow({ where: { courseId: course.id, title: "Ohm's law" } });
    await runLessonJob({ lessonId: ohm.id }, { writer: new FakeWriter(), model: "claude-sonnet-5-5", effort: "medium" });
    const written = await db.lesson.findUniqueOrThrow({ where: { id: ohm.id } });
    const before = await outline(course.id);

    const more = [{ name: "Week 2.pptx", bytes: makePptx(WEEK2) }];
    const added = await addDecks(user.id, course.id, { files: more.map(file), rightsConfirmed: true });
    await upload(added.uploads, more);
    expect(await completeDecks(user.id, course.id)).toMatchObject({ ok: true, failed: [] });
    expect((await db.course.findUniqueOrThrow({ where: { id: course.id } })).status).toBe("ACTIVE"); // stays open meanwhile

    await processBook(course.bookId, { ocr });
    expect((await db.course.findUniqueOrThrow({ where: { id: course.id } })).status).toBe("ACTIVE");
    const after = await outline(course.id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe("Week 2: Title and agenda (skip) 12-12, Series circuits 13-14, Closing slides (skip) 15-15");
    // The written lesson is untouched; the new ones wait to be generated.
    expect(await db.lesson.findUniqueOrThrow({ where: { id: ohm.id } })).toMatchObject({ content: written.content, status: "READY", pageStart: 7, pageEnd: 10 });
    expect(await db.lesson.count({ where: { courseId: course.id, unit: { title: "Week 2" }, status: "PENDING" } })).toBe(3);
    expect((await db.page.findFirstOrThrow({ where: { bookId: course.bookId, pageNumber: 7 } })).text).toContain("Ohm");
    expect(await db.page.count({ where: { bookId: course.bookId } })).toBe(15);
  });

  it("makes an existing single-deck slides course's slides its first deck", async () => {
    const { course } = await newCollage([{ name: "only.pdf", bytes: await makeSlidesPdf(LECTURE) }]);
    await processBook(course.bookId, { ocr });
    // Pretend it was uploaded before collages existed: no deck rows.
    await db.deck.deleteMany({ where: { bookId: course.bookId } });
    await db.course.update({ where: { id: course.id }, data: { status: "ACTIVE" } });
    const more = [{ name: "Week 2.pdf", bytes: await makeSlidesPdf(WEEK2) }];
    const added = await addDecks(course.userId, course.id, { files: more.map(file), rightsConfirmed: true });
    await upload(added.uploads, more);
    await completeDecks(course.userId, course.id);
    await processBook(course.bookId, { ocr });
    const decks = (await getDecks(course.userId, course.id))!.decks;
    expect(decks.map((d) => [d.title, d.status, d.pageStart, d.pageEnd])).toEqual([
      ["Physics 101", "READY", 1, 11],
      ["Week 2", "READY", 12, 15],
    ]);
  });

  it("leaves out a deck that can't be read and goes ahead with the others; it can be removed", async () => {
    const files = [
      { name: "good.pdf", bytes: await makeSlidesPdf(LECTURE) },
      { name: "broken.pdf", bytes: BROKEN_PDF },
      { name: "notes.pptx", bytes: Buffer.from("this is not a zip") },
    ];
    const { user, course, done } = await newCollage(files);
    // The fake PowerPoint is caught at upload; the broken PDF only when it's opened.
    expect(done).toMatchObject({ ok: true, failed: [{ filename: "notes.pptx", error: expect.stringContaining("PowerPoint") }] });
    await processBook(course.bookId, { ocr });
    const decks = (await getDecks(user.id, course.id))!.decks;
    expect(decks.map((d) => [d.originalFilename, d.status])).toEqual([
      ["good.pdf", "READY"],
      ["broken.pdf", "FAILED"],
      ["notes.pptx", "FAILED"],
    ]);
    expect(decks[1].error).toMatch(/couldn't read this file/);
    expect(decks.map((d) => d.retryable)).toEqual([false, false, false]); // bad files can be removed, not retried
    expect((await db.book.findUniqueOrThrow({ where: { id: course.bookId } })).pageCount).toBe(11);

    await removeFailedDeck(user.id, course.id, decks[1].id);
    await expect(removeFailedDeck(user.id, course.id, decks[0].id)).rejects.toBeInstanceOf(CollageError);
    expect((await getDecks(user.id, course.id))!.decks).toHaveLength(2);
  });

  it("fails a new collage only when no deck can be used", async () => {
    const { course, done } = await newCollage([{ name: "broken.pdf", bytes: BROKEN_PDF }]);
    expect(done.ok).toBe(true);
    const outcome = await runProcessBookJob({ jobId: "none", bookId: course.bookId, attempt: 1, maxAttempts: 1 }, { ocr });
    expect(outcome).toBe("failed");
    expect(await db.course.findUniqueOrThrow({ where: { id: course.id }, select: { status: true } })).toEqual({ status: "FAILED" });
  });

  it("keeps a course open when adding decks fails, and can retry them", async () => {
    const { user, course } = await newCollage([{ name: "week1.pdf", bytes: await makeSlidesPdf(LECTURE) }]);
    await processBook(course.bookId, { ocr });
    await db.course.update({ where: { id: course.id }, data: { status: "ACTIVE" } });
    const more = [{ name: "week2.pdf", bytes: await makeSlidesPdf(WEEK2) }];
    const added = await addDecks(user.id, course.id, { files: more.map(file), rightsConfirmed: true });
    await upload(added.uploads, more);
    await completeDecks(user.id, course.id);
    // The worker can't open the merged PDF (say, storage is down) on its last attempt.
    const key = (await db.book.findUniqueOrThrow({ where: { id: course.bookId } })).storageKey;
    const saved = await storage.getBuffer(key);
    await storage.delete(key);
    expect(await runProcessBookJob({ jobId: "none", bookId: course.bookId, attempt: 1, maxAttempts: 1 }, { ocr })).toBe("failed");
    expect(await db.course.findUniqueOrThrow({ where: { id: course.id }, select: { status: true } })).toEqual({ status: "ACTIVE" });
    expect((await db.book.findUniqueOrThrow({ where: { id: course.bookId } })).status).toBe("READY");
    expect((await getDecks(user.id, course.id))!.decks.map((d) => [d.status, d.retryable])).toEqual([
      ["READY", false],
      ["FAILED", true],
    ]);

    await storage.put(key, saved, "application/pdf");
    await retryDecks(user.id, course.id);
    await processBook(course.bookId, { ocr });
    expect((await getDecks(user.id, course.id))!.decks.map((d) => [d.status, d.pageStart])).toEqual([
      ["READY", 1],
      ["READY", 12],
    ]);
  });

  it("checks files, limits and ownership", async () => {
    const user = await createUser();
    const pdf = { filename: "a.pdf", size: 1000, contentType: "application/pdf" };
    await expect(createCollage(user.id, { title: "x", files: [], rightsConfirmed: true })).rejects.toThrow("at least one");
    await expect(createCollage(user.id, { title: "x", files: [pdf], rightsConfirmed: false })).rejects.toThrow("right to use");
    await expect(createCollage(user.id, { title: "x", files: [{ ...pdf, filename: "a.key" }, pdf], rightsConfirmed: true })).rejects.toThrow("a.key:");
    await expect(createCollage(user.id, { title: "x", files: Array(16).fill(pdf), rightsConfirmed: true })).rejects.toThrow("up to 15");
    const { course } = await newCollage([{ name: "w.pdf", bytes: await makeSlidesPdf(WEEK2) }]);
    await expect(addDecks(user.id, course.id, { files: [pdf], rightsConfirmed: true })).rejects.toBeInstanceOf(NotFoundError);
    // Still processing: wait before adding more.
    await expect(addDecks(course.userId, course.id, { files: [pdf], rightsConfirmed: true })).rejects.toThrow("finished processing");
  });
});
