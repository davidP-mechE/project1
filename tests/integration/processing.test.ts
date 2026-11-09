import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { storage, storageKeys } from "@/server/storage";
import { OcrPool } from "@/server/processing/ocr";
import { PdfReader } from "@/server/processing/pdf-reader";
import { processBook } from "@/server/processing/process-book";
import { runProcessBookJob } from "@/server/processing/run-job";
import { MATH_HEAVY_THRESHOLD } from "@/lib/pdf/math-score";
import { MAX_PAGES } from "@/lib/upload/limits";
import { createUser, resetDb } from "../helpers/db";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}.pdf`);

/** Create a user's uploaded book + course + job, with the PDF already in storage. */
async function uploaded(pdf: Buffer, name = "book") {
  const user = await createUser();
  const book = await db.book.create({
    data: { userId: user.id, originalFilename: `${name}.pdf`, storageKey: `tmp-${name}-${Date.now()}`, sizeBytes: BigInt(pdf.length), status: "UPLOADED" },
  });
  const key = storageKeys.bookOriginal(user.id, book.id);
  await db.book.update({ where: { id: book.id }, data: { storageKey: key } });
  const course = await db.course.create({ data: { userId: user.id, bookId: book.id, title: name, status: "PROCESSING" } });
  await storage.put(key, pdf, "application/pdf");
  const job = await db.job.create({ data: { userId: user.id, bookId: book.id, courseId: course.id, type: "PROCESS_BOOK" } });
  return { user, book, course, job };
}

async function outlineOf(courseId: string) {
  const units = await db.unit.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  return units.map((u) => ({
    unit: u.title,
    skip: u.isFrontBackMatter,
    lessons: u.lessons.map((l) => `${l.title} p${l.pageStart}-${l.pageEnd}`),
  }));
}

const EXPECTED_OUTLINE = [
  { unit: "Front matter", skip: true, lessons: ["Front matter p1-2"] },
  { unit: "Contents", skip: true, lessons: ["Contents p3-3"] },
  { unit: "1 Electric Charge and Current", skip: false, lessons: ["1.1 Charge p4-4", "1.2 Current p5-5"] },
  { unit: "2 Resistance and Ohm's Law", skip: false, lessons: ["2.1 Resistors p6-6", "2.2 Ohm's Law p7-7"] },
  { unit: "3 Series and Parallel Circuits", skip: false, lessons: ["3 Series and Parallel Circuits p8-9"] },
  { unit: "Index", skip: true, lessons: ["Index p10-10"] },
];

// One shared OCR pool keeps the tests fast (starting Tesseract takes a moment).
const ocr = new OcrPool(1);
afterAll(() => ocr.close());
beforeEach(resetDb);

describe("processBook on a PDF with bookmarks", () => {
  it("extracts every page, figures, cover, outline and chunks", async () => {
    const { book, course, job } = await uploaded(fixture("outlined"));
    await processBook(book.id, { jobId: job.id, ocr });

    const c = await db.course.findUniqueOrThrow({ where: { id: course.id }, include: { book: true } });
    expect(c.status).toBe("OUTLINE_DRAFT");
    expect(c.outlineSource).toBe("BOOKMARKS");
    expect(c.book.status).toBe("READY");
    expect(c.book.pageCount).toBe(10);
    expect(c.book.hasBuiltInOutline).toBe(true);
    expect(await outlineOf(course.id)).toEqual(EXPECTED_OUTLINE);

    const pages = await db.page.findMany({ where: { bookId: book.id }, orderBy: { pageNumber: "asc" } });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pages.every((p) => p.textSource === "NATIVE")).toBe(true);
    expect(pages[3].text).toMatch(/^1 Electric Charge and Current\n\n1\.1 Charge\n\nElectric charge is an important idea/);
    // Front/back matter pages are marked so they can be skipped.
    expect(pages.filter((p) => p.isFrontBackMatter).map((p) => p.pageNumber)).toEqual([1, 2, 3, 10]);
    // The equations page is flagged as math-heavy; prose pages are not.
    expect(pages[6].mathScore).toBeGreaterThan(MATH_HEAVY_THRESHOLD);
    expect(pages[3].mathScore).toBeLessThan(MATH_HEAVY_THRESHOLD);
    expect(pages[6].text).toContain("P = I² R = V² / R");

    // The figure on page 6 is saved as an image linked to its page.
    const figures = await db.figure.findMany({ where: { bookId: book.id } });
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ pageNumber: 6, width: 480, height: 300 });
    const png = await storage.getBuffer(figures[0].storageKey);
    expect(png.subarray(1, 4).toString()).toBe("PNG");

    const cover = await storage.getBuffer(c.book.coverKey!);
    expect(cover[0]).toBe(0xff); // JPEG magic bytes
    expect(cover[1]).toBe(0xd8);

    // Chunks skip front/back matter and keep page references.
    const chunks = await db.chunk.findMany({ where: { bookId: book.id }, orderBy: { ordinal: "asc" } });
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.min(...chunks.map((ch) => ch.pageStart))).toBe(4);
    expect(Math.max(...chunks.map((ch) => ch.pageEnd))).toBe(9);
    expect(chunks.some((ch) => ch.text.includes("Copyright"))).toBe(false);

    const j = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.progress).toBe(100);
    expect(j.message).toMatch(/outline is ready/);
  });

  it("is safe to run twice (a retry doesn't duplicate anything)", async () => {
    const { book, course } = await uploaded(fixture("outlined"));
    await processBook(book.id, { ocr });
    await processBook(book.id, { ocr });
    expect(await db.page.count({ where: { bookId: book.id } })).toBe(10);
    expect(await db.figure.count({ where: { bookId: book.id } })).toBe(1);
    expect(await db.unit.count({ where: { courseId: course.id } })).toBe(6);
    expect(await outlineOf(course.id)).toEqual(EXPECTED_OUTLINE);
  });
});

describe("processBook on a PDF without bookmarks", () => {
  it("detects the same outline from heading font sizes", async () => {
    const { book, course } = await uploaded(fixture("no-outline"));
    await processBook(book.id, { ocr });
    const c = await db.course.findUniqueOrThrow({ where: { id: course.id }, include: { book: true } });
    expect(c.outlineSource).toBe("HEADINGS");
    expect(c.book.hasBuiltInOutline).toBe(false);
    expect(await outlineOf(course.id)).toEqual(EXPECTED_OUTLINE);
  });
});

describe("processBook on a scanned PDF", () => {
  it("runs OCR on image-only pages", async () => {
    const { book, course } = await uploaded(fixture("scanned"));
    await processBook(book.id, { ocr });
    const pages = await db.page.findMany({ where: { bookId: book.id }, orderBy: { pageNumber: "asc" } });
    expect(pages.map((p) => p.textSource)).toEqual(["OCR", "OCR"]);
    expect(pages[0].text).toContain("A capacitor stores energy in an electric field");
    expect(pages[1].text).toContain("measured in farads");
    expect(pages[0].ocrConfidence).toBeGreaterThan(80);
    // A scanned page IS an image; it shouldn't be saved again as a "figure".
    expect(await db.figure.count({ where: { bookId: book.id } })).toBe(0);
    // No headings to find in two pages of prose → fixed page ranges.
    const c = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(c.outlineSource).toBe("PAGE_RANGES");
    expect(await outlineOf(course.id)).toEqual([{ unit: "Part 1", skip: false, lessons: ["Pages 1–2 p1-2"] }]);
  }, 60_000);
});

describe("runProcessBookJob failures", () => {
  it("fails with a friendly message for a damaged PDF", async () => {
    const { book, course, job } = await uploaded(Buffer.from("%PDF-1.4\nthis is not really a pdf\n%%EOF\n"));
    const outcome = await runProcessBookJob({ jobId: job.id, bookId: book.id, attempt: 1, maxAttempts: 2 }, { ocr });
    expect(outcome).toBe("failed"); // friendly errors are final: retrying won't help
    const j = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("FAILED");
    expect(j.error).toMatch(/couldn't read this PDF/);
    const c = await db.course.findUniqueOrThrow({ where: { id: course.id }, include: { book: true } });
    expect(c.status).toBe("FAILED");
    expect(c.book.error).toMatch(/couldn't read this PDF/);
  });

  it(`rejects books over ${MAX_PAGES} pages`, async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < MAX_PAGES + 1; i++) doc.addPage([200, 200]);
    const { book, job } = await uploaded(Buffer.from(await doc.save()));
    const outcome = await runProcessBookJob({ jobId: job.id, bookId: book.id, attempt: 1, maxAttempts: 2 }, { ocr });
    expect(outcome).toBe("failed");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).error).toMatch(/1,001 pages\. The limit is 1,000/);
  });

  it("asks for a retry on unexpected errors, then fails on the last attempt", async () => {
    const { book, job } = await uploaded(fixture("outlined"));
    // Simulate an unexpected crash while reading pages.
    const spy = vi.spyOn(PdfReader.prototype, "readPage").mockRejectedValue(new Error("boom"));
    const first = await runProcessBookJob({ jobId: job.id, bookId: book.id, attempt: 1, maxAttempts: 2 }, { ocr });
    expect(first).toBe("retry");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
    const last = await runProcessBookJob({ jobId: job.id, bookId: book.id, attempt: 2, maxAttempts: 2 }, { ocr });
    expect(last).toBe("failed");
    const j = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("FAILED");
    expect(j.error).toMatch(/Something went wrong/);
    expect(j.errorDetail).toContain("boom");
    spy.mockRestore();
  });

  it("stops quietly if the course was deleted", async () => {
    const { book, job } = await uploaded(fixture("outlined"));
    await db.book.delete({ where: { id: book.id } }); // cascades to course and job
    const outcome = await runProcessBookJob({ jobId: job.id, bookId: book.id, attempt: 1, maxAttempts: 2 }, { ocr });
    expect(outcome).toBe("gone");
  });
});
