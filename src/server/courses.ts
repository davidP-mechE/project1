import "server-only";
import { db } from "./db";
import { storage, storageKeys } from "./storage";
import { MAX_TITLE_LENGTH, MAX_UPLOADS_PER_HOUR, titleFromFilename } from "@/lib/upload/limits";
import { checkPdfSignature, PDF_HEAD_BYTES, PDF_TAIL_BYTES } from "@/lib/pdf/validate";

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

export async function listCourses(userId: string, opts: { archived: boolean }) {
  return db.course.findMany({
    where: { userId, archivedAt: opts.archived ? { not: null } : null },
    orderBy: [{ lastOpenedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      progressPct: true,
      lastOpenedAt: true,
      createdAt: true,
      archivedAt: true,
      book: { select: { id: true, coverKey: true, pageCount: true, status: true, error: true } },
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
  input: { filename: string; size: number; contentType: string; rightsConfirmed: boolean },
) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.book.count({ where: { userId, createdAt: { gte: since } } });
  if (recent >= MAX_UPLOADS_PER_HOUR) {
    throw new RateLimitError(`You can upload up to ${MAX_UPLOADS_PER_HOUR} books per hour. Please try again later.`);
  }

  const book = await db.book.create({
    data: {
      userId,
      originalFilename: input.filename.slice(0, 255),
      storageKey: `pending-${crypto.randomUUID()}`, // replaced below once we know the id
      sizeBytes: BigInt(input.size),
      rightsConfirmed: input.rightsConfirmed,
    },
  });
  const storageKey = storageKeys.bookOriginal(userId, book.id);
  const [, course] = await db.$transaction([
    db.book.update({ where: { id: book.id }, data: { storageKey } }),
    db.course.create({ data: { userId, bookId: book.id, title: titleFromFilename(input.filename) } }),
  ]);

  const target = await storage.createUploadUrl(storageKey, {
    contentType: "application/pdf",
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
  const tail = await storage.readRange(book.storageKey, Math.max(0, stored.size - PDF_TAIL_BYTES), stored.size - 1);
  const check = checkPdfSignature(head, tail);
  if (!check.ok) return fail(check.reason);

  await db.$transaction([
    db.book.update({ where: { id: book.id }, data: { status: "UPLOADED", error: null } }),
    db.course.update({ where: { id: book.course.id }, data: { status: "PROCESSING" } }),
  ]);
  // Phase 2: enqueue the "process book" background job here.
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
