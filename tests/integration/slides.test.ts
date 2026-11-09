import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { storage, storageKeys } from "@/server/storage";
import { OcrPool } from "@/server/processing/ocr";
import { processBook } from "@/server/processing/process-book";
import { createUpload, completeUpload, listCourses } from "@/server/courses";
import { runLessonJob } from "@/server/generation/run";
import { getCourseExport } from "@/server/export";
import { courseToMarkdown } from "@/lib/export/course-markdown";
import { createUser, resetDb } from "../helpers/db";
import { FakeWriter } from "../helpers/fake-claude";
import { LECTURE, makePptx, makeSlidesPdf, TINY_PNG } from "../helpers/slides";

vi.mock("@/server/queue", async (orig) => ({
  ...(await orig<typeof import("@/server/queue")>()),
  enqueueGeneration: async () => {},
  enqueueBookProcessing: async () => ({ id: "job" }),
  enqueueBookEmbedding: async () => {},
}));

const ocr = new OcrPool(1);
afterAll(() => ocr.close());
beforeEach(resetDb);

/** An uploaded slide deck: a PDF, or a .pptx (stored as the source, before conversion). */
async function deck(kind: "pdf" | "pptx", bytes: Uint8Array) {
  const user = await createUser();
  const book = await db.book.create({
    data: { userId: user.id, kind: "SLIDES", originalFilename: `lecture.${kind}`, storageKey: `tmp-${Date.now()}-${Math.random()}`, sizeBytes: BigInt(bytes.length), status: "UPLOADED" },
  });
  const key = kind === "pptx" ? storageKeys.slidesSource(user.id, book.id) : storageKeys.bookOriginal(user.id, book.id);
  await db.book.update({ where: { id: book.id }, data: { storageKey: key, sourceKey: kind === "pptx" ? key : null } });
  await storage.put(key, Buffer.from(bytes), kind === "pptx" ? "application/zip" : "application/pdf");
  const course = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Intro to Circuits", status: "PROCESSING" } });
  return { user, book, course };
}

async function outline(courseId: string) {
  const units = await db.unit.findMany({ where: { courseId }, orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } });
  return units.map((u) => `${u.title}${u.isFrontBackMatter ? " (skip)" : ""}: ${u.lessons.map((l) => `${l.title} ${l.pageStart}-${l.pageEnd}`).join(", ")}`);
}

const EXPECTED = ["Title and agenda (skip): Title and agenda 1-2", "Charge and current: Charge and current 3-6", "Ohm's law: Ohm's law 7-10", "Closing slides (skip): Closing slides 11-11"];

describe("slide decks", () => {
  it("reads a PDF deck: one page per slide, outline from slide titles and section slides", async () => {
    const { book, course } = await deck("pdf", await makeSlidesPdf(LECTURE));
    await processBook(book.id, { ocr });
    expect(await db.book.findUnique({ where: { id: book.id }, select: { status: true, pageCount: true } })).toEqual({ status: "READY", pageCount: 11 });
    expect(await db.course.findUnique({ where: { id: course.id }, select: { status: true, outlineSource: true } })).toEqual({ status: "OUTLINE_DRAFT", outlineSource: "SLIDES" });
    expect(await outline(course.id)).toEqual(EXPECTED);
  });

  it("reads a PowerPoint deck: lays it out as a PDF and keeps its own text and speaker notes", async () => {
    const slides = LECTURE.map((s, i) => (i === 7 ? { ...s, image: TINY_PNG } : s));
    const { user, book, course } = await deck("pptx", makePptx(slides));
    await processBook(book.id, { ocr });
    const after = await db.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(after.status).toBe("READY");
    expect(after.storageKey).toBe(storageKeys.bookOriginal(user.id, book.id));
    expect(after.sourceKey).toBe(storageKeys.slidesSource(user.id, book.id));
    expect((await storage.getBuffer(after.storageKey)).subarray(0, 5).toString()).toBe("%PDF-");
    const page4 = await db.page.findUniqueOrThrow({ where: { bookId_pageNumber: { bookId: book.id, pageNumber: 4 } } });
    expect(page4.text).toContain("Speaker notes: Remind students that electrons carry negative charge.");
    // Unicode from the .pptx survives, even though the PDF's fonts can't draw it.
    const page8 = await db.page.findUniqueOrThrow({ where: { bookId_pageNumber: { bookId: book.id, pageNumber: 8 } } });
    expect(page8.text).toContain("Measured in ohms (Ω)");
    expect(await outline(course.id)).toEqual(EXPECTED);

    // Writing a lesson: Claude is told these are slides, and picture slides are read from their image.
    const lesson = await db.lesson.findFirstOrThrow({ where: { courseId: course.id, skip: false }, orderBy: [{ unit: { order: "desc" } }] });
    await db.page.update({ where: { bookId_pageNumber: { bookId: book.id, pageNumber: 8 } }, data: { imageCount: 1 } });
    const writer = new FakeWriter();
    const outcome = await runLessonJob({ lessonId: lesson.id }, { writer, model: "m", effort: "low", renderPage: async () => Buffer.from("png") });
    expect(outcome).toBe("generated");
    expect(writer.lessonCalls[0].sourceKind).toBe("slides");
    expect(writer.repairKinds).toEqual(["slides"]);

    // Exports say "slide", not "p.".
    const md = courseToMarkdown(await getCourseExport(user.id, course.id), { answers: true, flashcards: true }, new Date());
    expect(md).toContain("_slides 7–10_");
    expect(md).not.toContain("_pp. ");
  });

  it("explains a broken PowerPoint file", async () => {
    const { book } = await deck("pptx", new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]));
    await expect(processBook(book.id, { ocr })).rejects.toThrow(/couldn't be opened/);
  });

  it("uploads slides separately from books", async () => {
    const user = await createUser();
    const up = await createUpload(user.id, { filename: "Week 3.pptx", size: 100, contentType: "", rightsConfirmed: true, kind: "slides" });
    const book = await db.book.findUniqueOrThrow({ where: { id: up.bookId } });
    expect(book).toMatchObject({ kind: "SLIDES", storageKey: storageKeys.slidesSource(user.id, up.bookId), sourceKey: storageKeys.slidesSource(user.id, up.bookId) });
    // Not a zip file: rejected before processing.
    await storage.put(book.storageKey, Buffer.alloc(100, 1), "application/zip");
    expect(await completeUpload(user.id, up.bookId)).toMatchObject({ ok: false, error: expect.stringContaining("PowerPoint") });
    const pptx = makePptx(LECTURE);
    const up2 = await createUpload(user.id, { filename: "Week 4.pptx", size: pptx.length, contentType: "", rightsConfirmed: true, kind: "slides" });
    const b2 = await db.book.findUniqueOrThrow({ where: { id: up2.bookId } });
    await storage.put(b2.storageKey, Buffer.from(pptx), "application/zip");
    expect(await completeUpload(user.id, up2.bookId)).toMatchObject({ ok: true });
    await createUpload(user.id, { filename: "Textbook.pdf", size: 100, contentType: "application/pdf", rightsConfirmed: true });
    expect((await listCourses(user.id, { archived: false, kind: "SLIDES" })).map((c) => c.title)).toEqual(["Week 4", "Week 3"]);
    expect((await listCourses(user.id, { archived: false, kind: "BOOK" })).map((c) => c.title)).toEqual(["Textbook"]);
  });
});
