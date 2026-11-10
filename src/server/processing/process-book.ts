import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { storage, storageKeys } from "../storage";
import { MAX_PAGES, MAX_SLIDES } from "@/lib/upload/limits";
import { parsePptx, PptxError, slideSourceText, type PptxSlide } from "@/lib/slides/pptx";
import { slideOutline, titleFromLines } from "@/lib/slides/outline";
import { slidesToPdf } from "./slides-pdf";
import { deckUnit, mergeDecks } from "./collage";
import { mathScore } from "@/lib/pdf/math-score";
import { needsOcr } from "@/lib/pdf/text-quality";
import type { Line } from "@/lib/pdf/lines";
import { buildOutline, type PageFlag } from "@/lib/outline/build";
import { entriesFromBookmarks } from "@/lib/outline/from-bookmarks";
import { classifyPageText } from "@/lib/outline/front-back-matter";
import { detectHeadings } from "@/lib/outline/heading-detect";
import type { DraftUnit } from "@/lib/outline/types";
import { chunkPages } from "@/lib/chunking/chunk";
import { PdfOpenError, PdfReader } from "./pdf-reader";
import { cleanOcrText, OcrPool } from "./ocr";
import { ProgressReporter } from "./progress";
import { detectSubject } from "../subjects";

/**
 * The "process book" pipeline. Runs in the worker, one book at a time:
 *
 *   1. open      download the PDF and check the page count
 *   2. text      read every page's text (with font sizes) and count its images
 *   3. ocr       pages with no usable text but with images are scanned → OCR
 *   4. figures   save embedded images, linked to their page
 *   5. cover     render page 1 as the cover thumbnail
 *   6. outline   bookmarks → units/lessons; otherwise detect headings; otherwise fixed page ranges
 *   7. chunks    split text into ~400-token passages for search and the tutor
 *
 * Slide decks (Book.kind = SLIDES) take the same path, with slides as pages.
 * A PowerPoint file is first laid out as a PDF (step 0); its own text, with
 * speaker notes, is used instead of the PDF's. The outline comes from slide
 * titles and section slides (src/lib/slides/outline.ts).
 *
 * Every step can be re-run safely: pages already read are skipped, and the
 * outline/chunks are replaced. So a retry after a crash picks up where it stopped.
 */

/** A failure with a message we can show the student. These are not retried. */
export class ProcessingError extends Error {}

/** The book (or course) was deleted while we were working: stop quietly. */
export class BookGoneError extends Error {}

const OCR_DPI = 300;
const OCR_MAX_PIXELS = 12_000_000; // ~ US Letter at 300 dpi, keeps memory in check
const FIGURE_MIN_PX = 120;
const FIGURES_PER_PAGE = 8;
const COVER_WIDTH = 360;
const SAVE_BATCH = 20;

// Progress budget (0-100) for each step.
const P = { open: 2, text: 35, ocr: 70, figures: 80, cover: 82, outline: 92, chunks: 99 };

export type ProcessOptions = { jobId?: string | null; ocr?: OcrPool; signal?: AbortSignal };

export async function processBook(bookId: string, opts: ProcessOptions = {}): Promise<void> {
  const progress = new ProgressReporter(opts.jobId ?? null);
  const ownOcr = !opts.ocr;
  const ocr = opts.ocr ?? new OcrPool();

  const book = await db.book.findUnique({ where: { id: bookId }, include: { course: true } });
  if (!book || !book.course) throw new BookGoneError();
  const course = book.course;
  // Slide collage: several decks merged into this book's PDF. Adding decks to a
  // course that's in use ("appending") leaves the course and its lessons open.
  const decks = await db.deck.findMany({ where: { bookId }, select: { status: true } });
  const collage = decks.length > 0;
  const appending = decks.some((d) => d.status === "READY");
  await db.$transaction([
    db.book.update({ where: { id: bookId }, data: { status: "PROCESSING", error: null } }),
    ...(appending ? [] : [db.course.update({ where: { id: course.id }, data: { status: "PROCESSING" } })]),
  ]);

  const slides = book.kind === "SLIDES";
  const word = slides ? "slide" : "page";

  // ── 0. PowerPoint → PDF ───────────────────────────────────────────────
  let pptx: PptxSlide[] | null = null;
  let collageText: Map<number, PptxSlide> | null = null;
  if (collage) {
    await progress.update("open", 0, appending ? "Adding your slides…" : "Putting your decks together…", true);
    const merged = await mergeDecks(book);
    if (merged.pageCount === 0) throw new ProcessingError("None of the decks could be read. Check they're PDF or PowerPoint (.pptx) files and upload them again.");
    collageText = merged.slideText;
  } else if (book.sourceKey) {
    await progress.update("open", 0, "Opening your slides…", true);
    const source = await storage.getBuffer(book.sourceKey).catch(() => {
      throw new ProcessingError("We couldn't find the uploaded file. Please delete these slides and upload them again.");
    });
    try {
      pptx = parsePptx(new Uint8Array(source), { maxSlides: MAX_SLIDES });
    } catch (err) {
      if (err instanceof PptxError) throw new ProcessingError(err.message);
      throw err;
    }
    if (pptx.length > MAX_SLIDES) {
      throw new ProcessingError(`This deck has more than ${MAX_SLIDES} slides. Try splitting it into smaller files.`);
    }
    if (book.storageKey === book.sourceKey) {
      const pdfKey = storageKeys.bookOriginal(book.userId, bookId);
      await storage.put(pdfKey, Buffer.from(await slidesToPdf(pptx, course.title)), "application/pdf");
      await db.book.update({ where: { id: bookId }, data: { storageKey: pdfKey } });
      book.storageKey = pdfKey;
    }
  }

  // ── 1. open ───────────────────────────────────────────────────────────
  await progress.update("open", 0, slides ? "Opening your slides…" : "Opening your PDF…", true);
  const data = await storage.getBuffer(book.storageKey).catch(() => {
    throw new ProcessingError("We couldn't find the uploaded file. Please delete this course and upload the PDF again.");
  });
  let reader: PdfReader;
  try {
    reader = await PdfReader.open(new Uint8Array(data));
  } catch (err) {
    if (err instanceof PdfOpenError) throw new ProcessingError(err.message);
    throw err;
  }

  try {
    const pageCount = reader.pageCount;
    if (slides && !collage && pageCount > MAX_SLIDES) {
      throw new ProcessingError(`This deck has ${pageCount} slides. The limit is ${MAX_SLIDES}. Try splitting it into smaller files.`);
    }
    if (pageCount > MAX_PAGES) {
      throw new ProcessingError(
        `This PDF has ${pageCount.toLocaleString("en-US")} pages. The limit is ${MAX_PAGES.toLocaleString("en-US")}. Try splitting it into smaller files (for example, one per part of the book).`,
      );
    }
    if (pageCount === 0) throw new ProcessingError(slides ? "This file has no slides." : "This PDF has no pages.");
    await db.book.update({ where: { id: bookId }, data: { pageCount } });
    const labels = await reader.pageLabels();
    await progress.update("open", P.open, `Found ${pageCount} ${word}s.`, true);

    // ── 2. text ─────────────────────────────────────────────────────────
    const done = new Set(
      (await db.page.findMany({ where: { bookId }, select: { pageNumber: true } })).map((p) => p.pageNumber),
    );
    let batch: Prisma.PageCreateManyInput[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await db.page.createMany({ data: batch, skipDuplicates: true });
      batch = [];
    };
    for (let n = 1; n <= pageCount; n++) {
      opts.signal?.throwIfAborted();
      if (done.has(n)) continue;
      const page = await reader.readPage(n);
      // PowerPoint: the deck's own text (with speaker notes) is better than reading it back from our PDF.
      const own = collageText ? collageText.get(n) : pptx?.[n - 1];
      if (own) page.text = slideSourceText(own);
      batch.push({
        bookId,
        pageNumber: n,
        label: labels?.[n - 1] || null,
        text: page.text,
        charCount: page.text.length,
        textSource: page.text.trim() ? "NATIVE" : "NONE",
        mathScore: mathScore(page.text),
        imageCount: page.imageCount,
        lines: page.lines,
        width: page.width,
        height: page.height,
      });
      if (batch.length >= SAVE_BATCH) await flush();
      await progress.update("text", P.open + ((P.text - P.open) * n) / pageCount, `Reading text… ${word} ${n} of ${pageCount}`);
    }
    await flush();
    await ensureBookExists(bookId);

    // ── 3. ocr ──────────────────────────────────────────────────────────
    const ocrCandidates = (
      await db.page.findMany({
        where: { bookId, textSource: { in: ["NATIVE", "NONE"] }, ocrConfidence: null },
        select: { pageNumber: true, text: true, imageCount: true },
        orderBy: { pageNumber: "asc" },
      })
    ).filter((p) => needsOcr(p.text, p.imageCount));
    for (const [i, p] of ocrCandidates.entries()) {
      opts.signal?.throwIfAborted();
      await progress.update(
        "ocr",
        P.text + ((P.ocr - P.text) * i) / ocrCandidates.length,
        `OCR on ${word} ${p.pageNumber} (${i + 1} of ${ocrCandidates.length} scanned ${word}s)…`,
        i === 0,
      );
      const canvas = await reader.render(p.pageNumber, { scale: OCR_DPI / 72, maxPixels: OCR_MAX_PIXELS });
      const result = await ocr.recognize(canvas.toBuffer("image/png"));
      const text = cleanOcrText(result.text);
      // Very low confidence usually means a photo or diagram, not text.
      const usable = text.length > 0 && result.confidence >= 30;
      await db.page.update({
        where: { bookId_pageNumber: { bookId, pageNumber: p.pageNumber } },
        data: {
          text: usable ? text : p.text,
          charCount: usable ? text.length : p.text.length,
          textSource: usable ? "OCR" : p.text.trim() ? "NATIVE" : "NONE",
          ocrConfidence: result.confidence,
          mathScore: mathScore(usable ? text : p.text),
        },
      });
    }

    // ── 4. figures ──────────────────────────────────────────────────────
    const figurePages = await db.page.findMany({
      where: { bookId, imageCount: { gt: 0 }, textSource: "NATIVE" }, // scanned pages ARE images; skip them
      select: { pageNumber: true },
      orderBy: { pageNumber: "asc" },
    });
    const pagesWithFigures = new Set(
      (await db.figure.findMany({ where: { bookId }, select: { pageNumber: true }, distinct: ["pageNumber"] })).map((f) => f.pageNumber),
    );
    for (const [i, { pageNumber }] of figurePages.entries()) {
      opts.signal?.throwIfAborted();
      if (pagesWithFigures.has(pageNumber)) continue;
      await progress.update(
        "figures",
        P.ocr + ((P.figures - P.ocr) * i) / figurePages.length,
        `Saving figures… ${word} ${pageNumber}`,
      );
      const images = await reader.extractImages(pageNumber, { minSize: FIGURE_MIN_PX, max: FIGURES_PER_PAGE });
      for (const [index, img] of images.entries()) {
        const key = `${storageKeys.bookPrefix(book.userId, bookId)}figures/p${pageNumber}-${index}.png`;
        await storage.put(key, img.png, "image/png");
        await db.figure.upsert({
          where: { bookId_pageNumber_index: { bookId, pageNumber, index } },
          create: { bookId, pageNumber, index, storageKey: key, width: img.width, height: img.height },
          update: { storageKey: key, width: img.width, height: img.height },
        });
      }
    }

    // ── 5. cover ────────────────────────────────────────────────────────
    await progress.update("cover", P.figures, "Making a cover thumbnail…", true);
    const cover = await reader.render(1, { width: COVER_WIDTH });
    const coverKey = `${storageKeys.bookPrefix(book.userId, bookId)}cover.jpg`;
    await storage.put(coverKey, cover.toBuffer("image/jpeg", 82), "image/jpeg");
    await db.book.update({ where: { id: bookId }, data: { coverKey } });

    // ── 6. outline ──────────────────────────────────────────────────────
    await progress.update("outline", P.cover, "Building the outline…", true);
    const pages = await db.page.findMany({
      where: { bookId },
      select: { pageNumber: true, text: true, lines: true },
      orderBy: { pageNumber: "asc" },
    });
    const linesByPage = new Map(pages.map((p) => [p.pageNumber, (p.lines ?? []) as Line[]]));
    const pageTop = (n: number) => {
      const lines = linesByPage.get(n);
      if (!lines || lines.length === 0) return null;
      return Math.max(...lines.map((l) => l.y + l.size));
    };

    let source: "BOOKMARKS" | "HEADINGS" | "PAGE_RANGES" | "SLIDES";
    let units: DraftUnit[];
    const slideTitle = (n: number, text: string) => ({
      number: n,
      title: (collageText ? collageText.get(n)?.title : pptx?.[n - 1]?.title) || titleFromLines(linesByPage.get(n) ?? []),
      text,
    });
    if (collage) {
      // One unit per deck that isn't in the outline yet.
      source = "SLIDES";
      const newDecks = await db.deck.findMany({ where: { bookId, status: "MERGED" }, orderBy: { order: "asc" } });
      units = newDecks.map((d) =>
        deckUnit(
          { title: d.title, pageStart: d.pageStart!, pageEnd: d.pageEnd! },
          pages.filter((p) => p.pageNumber >= d.pageStart! && p.pageNumber <= d.pageEnd!).map((p) => slideTitle(p.pageNumber, p.text)),
        ),
      );
      if (appending) await appendOutline(course.id, bookId, units, pageCount);
      else await saveOutline(course.id, bookId, units, source, pageCount);
      await db.deck.updateMany({ where: { id: { in: newDecks.map((d) => d.id) } }, data: { status: "READY", error: null } });
    } else if (slides) {
      source = "SLIDES";
      units = slideOutline(
        pages.map((p) => slideTitle(p.pageNumber, p.text)),
        course.title,
      );
    } else {
      const pageFlags: PageFlag[] = pages.map((p) => ({ pageNumber: p.pageNumber, frontBack: classifyPageText(p.text) !== null }));
      const fromBookmarks = entriesFromBookmarks(await reader.bookmarks(pageTop), pageCount);
      if (fromBookmarks.filter((e) => e.level === 1).length >= 2) {
        source = "BOOKMARKS";
        units = buildOutline(fromBookmarks, pageCount, pageFlags);
      } else {
        const detected = detectHeadings(pages.map((p) => ({ pageNumber: p.pageNumber, lines: linesByPage.get(p.pageNumber) ?? [] })));
        if (detected.filter((e) => e.level === 1).length >= 2) {
          source = "HEADINGS";
          units = buildOutline(detected, pageCount, pageFlags);
        } else {
          source = "PAGE_RANGES";
          units = buildOutline([], pageCount, pageFlags);
        }
    }
    }
    if (!collage) await saveOutline(course.id, bookId, units, source, pageCount);
    if (!appending) await detectSubject(course.id).catch((err) => console.warn("[process] couldn't detect the subject:", err));

    // ── 7. chunks ───────────────────────────────────────────────────────
    await progress.update("chunks", P.outline, "Preparing text for search…", true);
    const frontBackPages = new Set(
      (await db.page.findMany({ where: { bookId, isFrontBackMatter: true }, select: { pageNumber: true } })).map((p) => p.pageNumber),
    );
    const chunks = chunkPages(pages.filter((p) => !frontBackPages.has(p.pageNumber)).map((p) => ({ pageNumber: p.pageNumber, text: p.text })));
    await db.$transaction([
      db.chunk.deleteMany({ where: { bookId } }),
      db.chunk.createMany({ data: chunks.map((c) => ({ bookId, ...c })) }),
    ]);

    // ── done ────────────────────────────────────────────────────────────
    await db.$transaction([
      db.book.update({ where: { id: bookId }, data: { status: "READY", error: null } }),
      // Added decks join a course that's already open: its new lessons wait to be generated.
      ...(appending ? [] : [db.course.update({ where: { id: course.id }, data: { status: "OUTLINE_DRAFT" } })]),
    ]);
    await progress.update(
      "done",
      100,
      appending ? `Done! Added ${units.length} ${units.length === 1 ? "deck" : "decks"}. Generate their lessons from the course page.` : "Done! Your outline is ready to review.",
      true,
    );
  } catch (err) {
    // Deleted mid-way? Prisma reports missing rows as P2025 / foreign-key errors (P2003).
    const code = (err as { code?: string }).code;
    if (code === "P2025" || code === "P2003") throw new BookGoneError();
    throw err;
  } finally {
    await reader.close().catch(() => {});
    if (ownOcr) await ocr.close().catch(() => {});
  }
}

/** Add units for newly added decks after the course's existing ones, without touching anything already there. */
async function appendOutline(courseId: string, bookId: string, units: DraftUnit[], pageCount: number) {
  const last = await db.unit.findFirst({ where: { courseId }, orderBy: { order: "desc" }, select: { order: true } });
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, select: { detectedOutline: true } });
  const frontBack = units.flatMap((u) => u.lessons.filter((l) => l.isFrontBackMatter).flatMap((l) => Array.from({ length: l.pageEnd - l.pageStart + 1 }, (_, i) => l.pageStart + i)));
  await db.$transaction(async (tx) => {
    for (const [i, u] of units.entries()) {
      await tx.unit.create({
        data: {
          courseId,
          order: (last?.order ?? -1) + 1 + i,
          title: u.title.slice(0, 300),
          isFrontBackMatter: u.isFrontBackMatter,
          lessons: {
            create: u.lessons.map((l, j) => ({
              courseId,
              order: j,
              title: l.title.slice(0, 300),
              pageStart: Math.max(1, l.pageStart),
              pageEnd: Math.min(pageCount, l.pageEnd),
              isFrontBackMatter: l.isFrontBackMatter,
              skip: l.isFrontBackMatter,
            })),
          },
        },
      });
    }
    if (frontBack.length > 0) await tx.page.updateMany({ where: { bookId, pageNumber: { in: frontBack } }, data: { isFrontBackMatter: true } });
    const before = Array.isArray(course.detectedOutline) ? (course.detectedOutline as unknown[]) : [];
    await tx.course.update({ where: { id: courseId }, data: { detectedOutline: [...before, ...units] as unknown as Prisma.InputJsonValue } });
  });
}

async function ensureBookExists(bookId: string) {
  const exists = await db.book.count({ where: { id: bookId } });
  if (!exists) throw new BookGoneError();
}

/** Replace the course outline with the detected one and mark front/back-matter pages. */
async function saveOutline(courseId: string, bookId: string, units: DraftUnit[], source: "BOOKMARKS" | "HEADINGS" | "PAGE_RANGES" | "SLIDES", pageCount: number) {
  const frontBack = new Set<number>();
  for (const u of units) {
    for (const l of u.lessons) {
      if (l.isFrontBackMatter) for (let p = l.pageStart; p <= l.pageEnd; p++) frontBack.add(p);
    }
  }
  await db.$transaction(async (tx) => {
    await tx.unit.deleteMany({ where: { courseId } });
    for (const [order, u] of units.entries()) {
      await tx.unit.create({
        data: {
          courseId,
          order,
          title: u.title.slice(0, 300),
          isFrontBackMatter: u.isFrontBackMatter,
          lessons: {
            create: u.lessons.map((l, i) => ({
              courseId,
              order: i,
              title: l.title.slice(0, 300),
              pageStart: Math.max(1, l.pageStart),
              pageEnd: Math.min(pageCount, l.pageEnd),
              isFrontBackMatter: l.isFrontBackMatter,
              skip: l.isFrontBackMatter,
            })),
          },
        },
      });
    }
    await tx.page.updateMany({ where: { bookId }, data: { isFrontBackMatter: false } });
    if (frontBack.size > 0) {
      await tx.page.updateMany({ where: { bookId, pageNumber: { in: [...frontBack] } }, data: { isFrontBackMatter: true } });
    }
    await tx.course.update({
      where: { id: courseId },
      data: { outlineSource: source, detectedOutline: units as unknown as Prisma.InputJsonValue },
    });
    await tx.book.update({ where: { id: bookId }, data: { hasBuiltInOutline: source === "BOOKMARKS" } });
  });
}
