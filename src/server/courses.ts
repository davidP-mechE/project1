import "server-only";
import { db } from "./db";
import { enqueueBookProcessing } from "./queue";
import { storage, storageKeys } from "./storage";
import { isPptx, MAX_TITLE_LENGTH, MAX_UPLOADS_PER_HOUR, PPTX_TYPE, titleFromFilename, type UploadKind } from "@/lib/upload/limits";
import { assertCanUpload, LimitError } from "./limits";
import { checkPdfSignature, PDF_HEAD_BYTES, PDF_TAIL_BYTES } from "@/lib/pdf/validate";
import { MATH_HEAVY_THRESHOLD } from "@/lib/pdf/math-score";

/**
 * Data access for books and courses.
 * RULE: every function takes the current user's id and filters by it, so a
 * student can never read or change someone else's books, even by guessing ids.
 */

export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
  }
}

export async function listCourses(userId: string, opts: { archived: boolean; kind?: "BOOK" | "SLIDES" }) {
  return db.course.findMany({
    where: { userId, archivedAt: opts.archived ? { not: null } : null, ...(opts.kind ? { book: { kind: opts.kind } } : {}) },
    orderBy: [{ lastOpenedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      progressPct: true,
      lastOpenedAt: true,
      createdAt: true,
      archivedAt: true,
      book: { select: { id: true, kind: true, coverKey: true, pageCount: true, status: true, error: true } },
      _count: { select: { lessons: true } },
    },
  });
}

export async function getCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    include: {
      book: {
        select: {
          id: true,
          kind: true,
          originalFilename: true,
          sizeBytes: true,
          pageCount: true,
          status: true,
          error: true,
          createdAt: true,
        },
      },
    },
  });
  if (!course) throw new NotFoundError("Course not found");
  return course;
}

export async function markCourseOpened(userId: string, courseId: string) {
  await db.course.updateMany({ where: { id: courseId, userId }, data: { lastOpenedAt: new Date() } });
}

export async function renameCourse(userId: string, courseId: string, title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
  if (!clean) throw new Error("Title can't be empty.");
  const res = await db.course.updateMany({ where: { id: courseId, userId }, data: { title: clean } });
  if (res.count === 0) throw new NotFoundError("Course not found");
}

export async function setCourseArchived(userId: string, courseId: string, archived: boolean) {
  const res = await db.course.updateMany({
    where: { id: courseId, userId },
    data: { archivedAt: archived ? new Date() : null },
  });
  if (res.count === 0) throw new NotFoundError("Course not found");
}

/** Deletes the course, its book record (cascade) and every stored file for that book. */
export async function deleteCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { bookId: true } });
  if (!course) throw new NotFoundError("Course not found");
  await storage.deletePrefix(storageKeys.bookPrefix(userId, course.bookId));
  await db.book.delete({ where: { id: course.bookId } }); // course is deleted by cascade
}

export async function deleteAllUserFiles(userId: string) {
  await storage.deletePrefix(storageKeys.userPrefix(userId));
}

// ─── Uploads ──────────────────────────────────────────────────────────────

export class RateLimitError extends Error {}

export async function createUpload(
  userId: string,
  input: { filename: string; size: number; contentType: string; rightsConfirmed: boolean; kind?: UploadKind },
) {
  const slides = input.kind === "slides";
  const pptx = slides && isPptx(input.filename);
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.book.count({ where: { userId, createdAt: { gte: since } } });
  if (recent >= MAX_UPLOADS_PER_HOUR) {
    throw new RateLimitError(`You can upload up to ${MAX_UPLOADS_PER_HOUR} books per hour. Please try again later.`);
  }
  try {
    await assertCanUpload(userId, input.size);
  } catch (err) {
    if (err instanceof LimitError) throw new RateLimitError(err.message);
    throw err;
  }

  const book = await db.book.create({
    data: {
      userId,
      originalFilename: input.filename.slice(0, 255),
      storageKey: `pending-${crypto.randomUUID()}`, // replaced below once we know the id
      sizeBytes: BigInt(input.size),
      rightsConfirmed: input.rightsConfirmed,
      kind: slides ? "SLIDES" : "BOOK",
    },
  });
  // A PowerPoint file is stored as-is; the worker makes the PDF the viewer shows.
  const storageKey = pptx ? storageKeys.slidesSource(userId, book.id) : storageKeys.bookOriginal(userId, book.id);
  const [, course] = await db.$transaction([
    db.book.update({ where: { id: book.id }, data: { storageKey, sourceKey: pptx ? storageKey : null } }),
    db.course.create({ data: { userId, bookId: book.id, title: titleFromFilename(input.filename) } }),
  ]);

  const target = await storage.createUploadUrl(storageKey, {
    contentType: pptx ? PPTX_TYPE : "application/pdf",
    contentLength: input.size,
    expiresInSeconds: 60 * 60,
  });
  return { bookId: book.id, courseId: course.id, upload: target };
}

export type CompleteResult = { ok: true; courseId: string } | { ok: false; error: string };

/** Called after the browser finishes uploading: verify the file really is a valid PDF. */
export async function completeUpload(userId: string, bookId: string): Promise<CompleteResult> {
  const book = await db.book.findFirst({ where: { id: bookId, userId }, include: { course: true } });
  if (!book || !book.course) throw new NotFoundError("Upload not found");
  if (book.status !== "AWAITING_UPLOAD") return { ok: true, courseId: book.course.id };

  const fail = async (error: string): Promise<CompleteResult> => {
    await storage.delete(book.storageKey).catch(() => {});
    await db.$transaction([
      db.book.update({ where: { id: book.id }, data: { status: "FAILED", error } }),
      db.course.update({ where: { id: book.course!.id }, data: { status: "FAILED" } }),
    ]);
    return { ok: false, error };
  };

  const stored = await storage.head(book.storageKey);
  if (!stored) return fail("The upload didn't finish. Please try again.");
  if (stored.size !== Number(book.sizeBytes)) {
    return fail("The uploaded file size doesn't match. The upload may have been interrupted; please try again.");
  }

  const head = await storage.readRange(book.storageKey, 0, PDF_HEAD_BYTES - 1);
  if (book.sourceKey) {
    // PowerPoint files are zip archives; the worker checks the slides inside.
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
      return fail("This doesn't look like a PowerPoint (.pptx) file. Try exporting the slides as a PDF instead.");
    }
  } else {
    const tail = await storage.readRange(book.storageKey, Math.max(0, stored.size - PDF_TAIL_BYTES), stored.size - 1);
    const check = checkPdfSignature(head, tail);
    if (!check.ok) return fail(check.reason);
  }

  await db.$transaction([
    db.book.update({ where: { id: book.id }, data: { status: "UPLOADED", error: null } }),
    db.course.update({ where: { id: book.course.id }, data: { status: "PROCESSING" } }),
  ]);
  await enqueueBookProcessing({ userId, bookId: book.id, courseId: book.course.id });
  return { ok: true, courseId: book.course.id };
}

/** Removes uploads that were started but never finished (called by a maintenance job later). */
export async function cleanupAbandonedUploads(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const stale = await db.book.findMany({ where: { status: "AWAITING_UPLOAD", createdAt: { lt: cutoff } } });
  for (const book of stale) {
    await storage.deletePrefix(storageKeys.bookPrefix(book.userId, book.id)).catch(() => {});
    await db.book.delete({ where: { id: book.id } });
  }
  return stale.length;
}

/** Try processing again after a failure (only if the original file is still stored). */
export async function retryProcessing(userId: string, courseId: string): Promise<CompleteResult> {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, include: { book: true } });
  if (!course) throw new NotFoundError("Course not found");
  if (course.book.status !== "FAILED") return { ok: true, courseId };
  const stored = await storage.head(course.book.storageKey);
  if (!stored) {
    return { ok: false, error: "The original file is no longer stored. Please delete this course and upload the PDF again." };
  }
  await db.$transaction([
    db.book.update({ where: { id: course.bookId }, data: { status: "UPLOADED", error: null } }),
    db.course.update({ where: { id: courseId }, data: { status: "PROCESSING" } }),
  ]);
  await enqueueBookProcessing({ userId, bookId: course.bookId, courseId });
  return { ok: true, courseId };
}

/** Latest processing job for a course, for the status display. */
export async function getProcessingStatus(userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: { status: true, book: { select: { status: true, error: true, pageCount: true } } },
  });
  if (!course) throw new NotFoundError("Course not found");
  const job = await db.job.findFirst({
    where: { courseId, type: "PROCESS_BOOK" },
    orderBy: { createdAt: "desc" },
    select: { status: true, step: true, progress: true, message: true, error: true, updatedAt: true },
  });
  return { courseStatus: course.status, bookStatus: course.book.status, bookError: course.book.error, pageCount: course.book.pageCount, job };
}

/** The detected outline plus a few facts about the extraction, for the course page. */
export async function getOutlineSummary(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, bookId: true, outlineSource: true } });
  if (!course) throw new NotFoundError("Course not found");
  const [units, ocrPages, mathPages, figureCount, emptyPages] = await Promise.all([
    db.unit.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: {
        id: true,
        title: true,
        isFrontBackMatter: true,
        lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, pageStart: true, pageEnd: true, isFrontBackMatter: true, skip: true } },
      },
    }),
    db.page.count({ where: { bookId: course.bookId, textSource: "OCR" } }),
    db.page.findMany({
      where: { bookId: course.bookId, mathScore: { gte: MATH_HEAVY_THRESHOLD }, isFrontBackMatter: false },
      select: { pageNumber: true },
      orderBy: { pageNumber: "asc" },
    }),
    db.figure.count({ where: { bookId: course.bookId } }),
    db.page.count({ where: { bookId: course.bookId, textSource: "NONE", isFrontBackMatter: false } }),
  ]);
  return {
    outlineSource: course.outlineSource,
    units,
    ocrPages,
    mathHeavyPages: mathPages.map((p) => p.pageNumber),
    figureCount,
    emptyPages,
  };
}
