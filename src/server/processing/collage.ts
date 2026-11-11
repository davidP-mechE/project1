import { PDFDocument } from "pdf-lib";
import { db } from "../db";
import { storage, storageKeys } from "../storage";
import { MAX_PAGES, MAX_SLIDES } from "@/lib/upload/limits";
import { parsePptx, PptxError, type PptxSlide } from "@/lib/slides/pptx";
import { slideOutline } from "@/lib/slides/outline";
import type { DraftUnit } from "@/lib/outline/types";
import { slidesToPdf } from "./slides-pdf";

/**
 * Slide collages (src/server/collage.ts): merging uploaded decks into the
 * course's one PDF, and making a unit for each deck.
 */

type DeckRow = Awaited<ReturnType<typeof db.deck.findMany>>[number];

/** A deck that can't be used; the others carry on without it. */
class DeckError extends Error {}

async function readDeck(deck: DeckRow): Promise<{ pdf: PDFDocument; slides: PptxSlide[] | null }> {
  const file = await storage.getBuffer(deck.storageKey).catch(() => {
    throw new DeckError("The uploaded file is missing. Please upload this deck again.");
  });
  let bytes: Uint8Array = new Uint8Array(file);
  let slides: PptxSlide[] | null = null;
  if (deck.isPptx) {
    try {
      slides = parsePptx(bytes, { maxSlides: MAX_SLIDES });
    } catch (err) {
      if (err instanceof PptxError) throw new DeckError(err.message);
      throw err;
    }
    bytes = await slidesToPdf(slides, deck.title);
  }
  let pdf: PDFDocument;
  let count: number;
  try {
    pdf = await PDFDocument.load(bytes);
    count = pdf.getPageCount(); // a damaged file can load and still have no readable page tree
  } catch (err) {
    const encrypted = /encrypt/i.test(String(err));
    throw new DeckError(
      encrypted
        ? "This PDF is password-protected. Remove the password (or export it again) and upload it again."
        : "We couldn't read this file. Try exporting the slides as a PDF again.",
    );
  }
  if (count === 0) throw new DeckError("This file has no slides.");
  if (count > MAX_SLIDES) throw new DeckError(`This deck has ${count} slides. The limit is ${MAX_SLIDES}. Try splitting it into smaller files.`);
  return { pdf, slides };
}

/**
 * Add every newly uploaded deck to the end of the course's PDF, in order.
 * The merged PDF is saved under a new name and swapped in together with the
 * decks' slide ranges, so a crash halfway never leaves slides in twice.
 * Returns each PowerPoint slide's own text (with speaker notes) by page number,
 * for decks whose slides still have to be read.
 */
export async function mergeDecks(book: { id: string; userId: string; storageKey: string }): Promise<{ pageCount: number; slideText: Map<number, PptxSlide> }> {
  const decks = await db.deck.findMany({ where: { bookId: book.id }, orderBy: { order: "asc" } });
  const slideText = new Map<number, PptxSlide>();
  const pending = decks.filter((d) => d.status === "UPLOADED");
  const inPdf = decks.filter((d) => (d.status === "MERGED" || d.status === "READY") && d.pageEnd);
  let pageCount = Math.max(0, ...inPdf.map((d) => d.pageEnd!));

  if (pending.length > 0) {
    const merged = pageCount > 0 ? await PDFDocument.load(await storage.getBuffer(book.storageKey)) : await PDFDocument.create();
    const ranges: { id: string; pageStart: number; pageEnd: number }[] = [];
    for (const deck of pending) {
      try {
        const { pdf, slides } = await readDeck(deck);
        const count = pdf.getPageCount();
        if (pageCount + count > MAX_PAGES) {
          throw new DeckError(`Adding this deck would give the course more than ${MAX_PAGES.toLocaleString("en-US")} slides. Start a new course for it.`);
        }
        let pages;
        try {
          pages = await merged.copyPages(pdf, pdf.getPageIndices());
        } catch {
          throw new DeckError("We couldn't read this file. Try exporting the slides as a PDF again.");
        }
        for (const p of pages) merged.addPage(p);
        ranges.push({ id: deck.id, pageStart: pageCount + 1, pageEnd: pageCount + count });
        slides?.forEach((s, i) => slideText.set(pageCount + 1 + i, s));
        pageCount += count;
      } catch (err) {
        if (!(err instanceof DeckError)) throw err;
        // The file itself can't be used: drop it, so the deck can be removed but isn't retried.
        await storage.delete(deck.storageKey).catch(() => {});
        await db.deck.update({ where: { id: deck.id }, data: { status: "FAILED", error: err.message, storageKey: "pending-unusable" } });
      }
    }
    if (ranges.length > 0) {
      const key = storageKeys.combinedPdf(book.userId, book.id, Date.now());
      await storage.put(key, Buffer.from(await merged.save()), "application/pdf");
      const old = book.storageKey;
      await db.$transaction([
        db.book.update({ where: { id: book.id }, data: { storageKey: key, pageCount } }),
        ...ranges.map((r) => db.deck.update({ where: { id: r.id }, data: { status: "MERGED", error: null, pageStart: r.pageStart, pageEnd: r.pageEnd } })),
      ]);
      book.storageKey = key;
      // The old merged PDF isn't needed any more (a course made from one deck keeps its original as deck 1's file).
      if (old !== key && !old.startsWith("pending-") && !decks.some((d) => d.storageKey === old)) await storage.delete(old).catch(() => {});
    }
  }

  // Merged on an earlier, interrupted run: their slides may still need reading.
  for (const deck of decks.filter((d) => d.status === "MERGED" && d.isPptx && d.pageStart)) {
    try {
      const slides = parsePptx(new Uint8Array(await storage.getBuffer(deck.storageKey)), { maxSlides: MAX_SLIDES });
      slides.forEach((s, i) => slideText.set(deck.pageStart! + i, s));
    } catch {
      // Fall back to the text in the PDF.
    }
  }
  return { pageCount, slideText };
}

/** One unit per deck: titled after the deck, with lessons from its section slides (cover and closing slides skipped). */
export function deckUnit(deck: { title: string; pageStart: number; pageEnd: number }, slides: { number: number; title: string; text: string }[]): DraftUnit {
  // The outline is worked out for the deck on its own (slide 1 = its cover), then moved to where the deck sits in the course.
  const shift = deck.pageStart - 1;
  const lessons = slideOutline(
    slides.map((s) => ({ ...s, number: s.number - shift })),
    deck.title,
  )
    .flatMap((u) => u.lessons)
    .map((l) => ({ ...l, pageStart: l.pageStart + shift, pageEnd: l.pageEnd + shift }));
  return {
    title: deck.title,
    pageStart: deck.pageStart,
    pageEnd: deck.pageEnd,
    isFrontBackMatter: lessons.length > 0 && lessons.every((l) => l.isFrontBackMatter),
    lessons,
  };
}
