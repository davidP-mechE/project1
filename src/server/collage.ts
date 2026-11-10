import "server-only";
import { db } from "./db";
import { enqueueBookProcessing } from "./queue";
import { storage, storageKeys } from "./storage";
import { NotFoundError, RateLimitError } from "./courses";
import { assertCanUpload, LimitError } from "./limits";
import { checkPdfSignature, PDF_HEAD_BYTES, PDF_TAIL_BYTES } from "@/lib/pdf/validate";
import { isPptx, MAX_TITLE_LENGTH, MAX_UPLOADS_PER_HOUR, PPTX_TYPE, titleFromFilename, validateDeckFiles, type DeckFile } from "@/lib/upload/limits";

/**
 * Slide collages: one course made of several slide decks (lectures, weeks,
 * topics). Each deck is uploaded on its own, straight to storage; the worker
 * then merges them, in order, into the course's one PDF, and each deck becomes
 * a unit. More decks can be added to a slides course at any time.
 *
 * Every function checks the course belongs to the user.
 */

export class CollageError extends Error {}

/** Storage key of a deck whose file couldn't be used (and was deleted): it can only be removed. */
export const UNUSABLE = "pending-unusable";

/** Decks uploaded per hour (on top of the per-hour limit on new books). */
const MAX_DECKS_PER_HOUR = 60;

async function checkUploadLimits(userId: string, files: DeckFile[], newBook: boolean) {
  const since = new Date(Date.now() - 3600_000);
  const [books, decks] = await Promise.all([
    newBook ? db.book.count({ where: { userId, createdAt: { gte: since } } }) : 0,
    db.deck.count({ where: { book: { userId }, createdAt: { gte: since } } }),
  ]);
  if (newBook && books >= MAX_UPLOADS_PER_HOUR) throw new RateLimitError(`You can upload up to ${MAX_UPLOADS_PER_HOUR} books per hour. Please try again later.`);
  if (decks + files.length > MAX_DECKS_PER_HOUR) throw new RateLimitError(`You can upload up to ${MAX_DECKS_PER_HOUR} decks per hour. Please try again later.`);
  try {
    await assertCanUpload(userId, files.reduce((n, f) => n + f.size, 0));
  } catch (err) {
    if (err instanceof LimitError) throw new RateLimitError(err.message);
    throw err;
  }
}

/** Create the deck rows and an upload URL for each. */
async function deckUploads(userId: string, bookId: string, files: DeckFile[], firstOrder: number) {
  const out: { deckId: string; filename: string; upload: Awaited<ReturnType<typeof storage.createUploadUrl>> }[] = [];
  for (const [i, f] of files.entries()) {
    const pptx = isPptx(f.filename);
    const deck = await db.deck.create({
      data: {
        bookId,
        order: firstOrder + i,
        title: titleFromFilename(f.filename),
        originalFilename: f.filename.slice(0, 255),
        storageKey: `pending-${crypto.randomUUID()}`,
        isPptx: pptx,
        sizeBytes: BigInt(f.size),
      },
    });
    const storageKey = storageKeys.deckSource(userId, bookId, deck.id, pptx);
    await db.deck.update({ where: { id: deck.id }, data: { storageKey } });
    const upload = await storage.createUploadUrl(storageKey, { contentType: pptx ? PPTX_TYPE : "application/pdf", contentLength: f.size, expiresInSeconds: 3600 });
    out.push({ deckId: deck.id, filename: f.filename, upload });
  }
  return out;
}

/** Step 1 of a new collage: the course, and an upload URL for every deck. */
export async function createCollage(userId: string, input: { title: string; files: DeckFile[]; rightsConfirmed: boolean }) {
  const check = validateDeckFiles(input.files, input.rightsConfirmed);
  if (!check.ok) throw new CollageError(check.error);
  const title = input.title.trim().slice(0, MAX_TITLE_LENGTH) || titleFromFilename(input.files[0].filename);
  await checkUploadLimits(userId, input.files, true);

  const book = await db.book.create({
    data: {
      userId,
      kind: "SLIDES",
      originalFilename: `${input.files.length} slide decks`,
      storageKey: `pending-${crypto.randomUUID()}`, // the merged PDF, made by the worker
      sizeBytes: BigInt(input.files.reduce((n, f) => n + f.size, 0)),
      rightsConfirmed: true,
    },
  });
  const course = await db.course.create({ data: { userId, bookId: book.id, title } });
  const uploads = await deckUploads(userId, book.id, input.files, 0);
  return { courseId: course.id, uploads };
}

async function ownedSlidesCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    include: { book: { include: { decks: { orderBy: { order: "asc" } } } } },
  });
  if (!course) throw new NotFoundError("Course not found");
  if (course.book.kind !== "SLIDES") throw new CollageError("Slide decks can only be added to a slides course.");
  return course;
}

/**
 * Step 1 of adding decks to a slides course. A course made from one deck
 * becomes a collage: its existing slides are its first deck.
 */
export async function addDecks(userId: string, courseId: string, input: { files: DeckFile[]; rightsConfirmed: boolean }) {
  const course = await ownedSlidesCourse(userId, courseId);
  // A course added from the Hub shares the provided course's files; it can't be changed.
  if (course.catalogEntryId) throw new CollageError("Courses added from the Hub can't have slides added. Upload your decks as a new course instead.");
  if (course.book.status !== "READY") throw new CollageError("Wait until these slides have finished processing, then add more.");
  const kept = course.book.decks.filter((d) => d.status !== "FAILED" && d.status !== "AWAITING_UPLOAD");
  if (course.book.decks.some((d) => d.status === "UPLOADED" || d.status === "MERGED")) {
    throw new CollageError("Some decks are still being added to this course. Wait until they're done.");
  }
  const existing = kept.length || 1; // a one-deck course counts as one
  const check = validateDeckFiles(input.files, input.rightsConfirmed, existing);
  if (!check.ok) throw new CollageError(check.error);
  await checkUploadLimits(userId, input.files, false);

  let nextOrder = Math.max(-1, ...course.book.decks.map((d) => d.order)) + 1;
  if (course.book.decks.length === 0) {
    // The course's original slides become deck 1 (already merged and in the outline).
    await db.deck.create({
      data: {
        bookId: course.bookId,
        order: 0,
        title: course.title,
        originalFilename: course.book.originalFilename,
        storageKey: course.book.sourceKey ?? course.book.storageKey,
        isPptx: Boolean(course.book.sourceKey),
        sizeBytes: course.book.sizeBytes,
        status: "READY",
        pageStart: 1,
        pageEnd: course.book.pageCount ?? 1,
      },
    });
    nextOrder = 1;
  }
  // Uploads that were started but never finished are dropped.
  await db.deck.deleteMany({ where: { bookId: course.bookId, status: "AWAITING_UPLOAD" } });
  const uploads = await deckUploads(userId, course.bookId, input.files, nextOrder);
  return { courseId, uploads };
}

export type CompleteDecksResult = { ok: true; courseId: string; failed: { filename: string; error: string }[] } | { ok: false; error: string };

/**
 * Step 3: the browser finished uploading. Check each deck's file, then start
 * merging the good ones. A bad file is reported and left out; the rest go ahead.
 */
export async function completeDecks(userId: string, courseId: string): Promise<CompleteDecksResult> {
  const course = await ownedSlidesCourse(userId, courseId);
  const pending = course.book.decks.filter((d) => d.status === "AWAITING_UPLOAD");
  if (pending.length === 0) return { ok: true, courseId, failed: [] };

  const failed: { filename: string; error: string }[] = [];
  let addedBytes = 0;
  for (const deck of pending) {
    const error = await checkDeckFile(deck.storageKey, deck.isPptx, Number(deck.sizeBytes));
    if (error) {
      await storage.delete(deck.storageKey).catch(() => {});
      // The file is gone: this deck can be removed, not retried.
      await db.deck.update({ where: { id: deck.id }, data: { status: "FAILED", error, storageKey: UNUSABLE } });
      failed.push({ filename: deck.originalFilename, error });
    } else {
      await db.deck.update({ where: { id: deck.id }, data: { status: "UPLOADED", error: null } });
      addedBytes += Number(deck.sizeBytes);
    }
  }
  const good = pending.length - failed.length;
  const isNew = course.book.status === "AWAITING_UPLOAD";
  if (good === 0) {
    const error = failed.length === 1 ? failed[0].error : "None of the decks could be used. Check they're PDF or PowerPoint (.pptx) files and try again.";
    if (isNew) {
      await db.$transaction([
        db.book.update({ where: { id: course.bookId }, data: { status: "FAILED", error } }),
        db.course.update({ where: { id: courseId }, data: { status: "FAILED" } }),
      ]);
    }
    return { ok: false, error };
  }
  if (isNew) {
    await db.$transaction([
      // Only the files that were usable count towards storage.
      db.book.update({ where: { id: course.bookId }, data: { status: "UPLOADED", error: null, sizeBytes: BigInt(addedBytes), originalFilename: `${good} slide ${good === 1 ? "deck" : "decks"}` } }),
      db.course.update({ where: { id: courseId }, data: { status: "PROCESSING" } }),
    ]);
  } else {
    // Adding to a course in use: the course stays open while the new decks are merged.
    const total = course.book.decks.filter((d) => d.status === "READY").length + good;
    await db.book.update({
      where: { id: course.bookId },
      data: { sizeBytes: { increment: BigInt(addedBytes) }, originalFilename: `${total} slide decks` },
    });
  }
  await enqueueBookProcessing({ userId, bookId: course.bookId, courseId });
  return { ok: true, courseId, failed };
}

/** Is the stored file there, the right size, and really a PDF / PowerPoint? Returns a message if not. */
async function checkDeckFile(key: string, pptx: boolean, size: number): Promise<string | null> {
  const stored = await storage.head(key);
  if (!stored) return "The upload didn't finish. Please try again.";
  if (stored.size !== size) return "The uploaded file size doesn't match. The upload may have been interrupted; please try again.";
  const head = await storage.readRange(key, 0, PDF_HEAD_BYTES - 1);
  if (pptx) {
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
      ? null
      : "This doesn't look like a PowerPoint (.pptx) file. Try exporting the slides as a PDF instead.";
  }
  const tail = await storage.readRange(key, Math.max(0, stored.size - PDF_TAIL_BYTES), stored.size - 1);
  const check = checkPdfSignature(head, tail);
  return check.ok ? null : check.reason;
}

/** Try adding decks that failed during merging again (their files are still stored). */
export async function retryDecks(userId: string, courseId: string) {
  const course = await ownedSlidesCourse(userId, courseId);
  if (course.book.status !== "READY") throw new CollageError("Wait until these slides have finished processing.");
  const retryable = course.book.decks.filter((d) => d.status === "FAILED" && d.storageKey && !d.storageKey.startsWith("pending-"));
  const stored = [];
  for (const d of retryable) if (await storage.head(d.storageKey)) stored.push(d.id);
  // Decks already merged into the PDF only need their unit made.
  const unfinished = course.book.decks.filter((d) => d.status === "MERGED").map((d) => d.id);
  if (stored.length === 0 && unfinished.length === 0) throw new CollageError("There's nothing to retry: upload the decks again.");
  await db.deck.updateMany({ where: { id: { in: stored } }, data: { status: "UPLOADED", error: null } });
  await db.deck.updateMany({ where: { id: { in: unfinished } }, data: { error: null } });
  await enqueueBookProcessing({ userId, bookId: course.bookId, courseId });
}

/** Remove a deck that couldn't be added (decks already in the course stay: their lessons depend on them). */
export async function removeFailedDeck(userId: string, courseId: string, deckId: string) {
  const course = await ownedSlidesCourse(userId, courseId);
  const deck = course.book.decks.find((d) => d.id === deckId);
  if (!deck) throw new NotFoundError("Deck not found");
  if (deck.status !== "FAILED") throw new CollageError("Only decks that couldn't be added can be removed.");
  if (!deck.storageKey.startsWith("pending-")) await storage.delete(deck.storageKey).catch(() => {});
  await db.deck.delete({ where: { id: deck.id } });
}

/** The decks of a slides course, for the course page. */
export async function getDecks(userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: {
      book: {
        select: {
          kind: true,
          status: true,
          pageCount: true,
          decks: { orderBy: { order: "asc" }, select: { id: true, title: true, originalFilename: true, status: true, error: true, pageStart: true, pageEnd: true, storageKey: true } },
        },
      },
    },
  });
  if (!course || course.book.kind !== "SLIDES") return null;
  return {
    bookStatus: course.book.status,
    pageCount: course.book.pageCount,
    decks: course.book.decks
      .filter((d) => d.status !== "AWAITING_UPLOAD")
      .map(({ storageKey, ...d }) => ({
        ...d,
        // Worth trying again: the worker hit a problem, not the file itself.
        retryable: (d.status === "MERGED" && Boolean(d.error)) || (d.status === "FAILED" && !storageKey.startsWith("pending-")),
      })),
  };
}
