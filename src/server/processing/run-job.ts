import { db } from "../db";
import { BookGoneError, ProcessingError, processBook } from "./process-book";
import type { OcrPool } from "./ocr";

/**
 * Runs one "process book" job and records the outcome on the Job, Book and
 * Course rows. Kept separate from BullMQ so tests can call it directly.
 *
 * Returns "retry" for unexpected errors that may succeed on another attempt.
 */
export async function runProcessBookJob(
  input: { jobId: string; bookId: string; attempt: number; maxAttempts: number },
  deps: { ocr?: OcrPool } = {},
): Promise<"done" | "gone" | "failed" | "retry"> {
  const { jobId, bookId, attempt, maxAttempts } = input;
  await db.job.updateMany({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date(), attempts: attempt, error: null, errorDetail: null },
  });
  try {
    await processBook(bookId, { jobId, ocr: deps.ocr });
    await db.job.updateMany({ where: { id: jobId }, data: { status: "SUCCEEDED", progress: 100, finishedAt: new Date() } });
    return "done";
  } catch (err) {
    if (err instanceof BookGoneError) {
      // The student deleted the course while it was processing. Nothing to report.
      await db.job.deleteMany({ where: { id: jobId } });
      return "gone";
    }
    const friendly = err instanceof ProcessingError;
    const lastAttempt = friendly || attempt >= maxAttempts;
    const message = friendly
      ? err.message
      : "Something went wrong while reading this PDF. Please try again. If it keeps happening, the file may be unusual or damaged.";
    const detail = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}`.slice(0, 4000) : String(err);
    console.error(`[process-book] job ${jobId} attempt ${attempt} failed:`, detail);

    if (!lastAttempt) {
      await db.job.updateMany({
        where: { id: jobId },
        data: { status: "QUEUED", message: "Hit a problem. Trying again shortly…", errorDetail: detail },
      });
      return "retry";
    }
    await db.job.updateMany({
      where: { id: jobId },
      data: { status: "FAILED", error: message, errorDetail: detail, message, finishedAt: new Date() },
    });
    const book = await db.book.findUnique({ where: { id: bookId }, select: { course: { select: { id: true } } } });
    // Adding decks to a course that's in use: the course and its slides are fine; only the new decks failed.
    // (Decks already merged keep their place in the PDF and are finished on a retry.)
    const appending = (await db.deck.count({ where: { bookId, status: "READY" } })) > 0;
    if (book && appending) {
      await db.$transaction([
        db.deck.updateMany({ where: { bookId, status: "UPLOADED" }, data: { status: "FAILED", error: message } }),
        db.deck.updateMany({ where: { bookId, status: "MERGED" }, data: { error: message } }),
        db.book.update({ where: { id: bookId }, data: { status: "READY", error: null } }),
      ]);
      return "failed";
    }
    if (book) {
      await db.$transaction([
        db.book.update({ where: { id: bookId }, data: { status: "FAILED", error: message } }),
        ...(book.course ? [db.course.update({ where: { id: book.course.id }, data: { status: "FAILED" } })] : []),
      ]);
    }
    return "failed";
  }
}
