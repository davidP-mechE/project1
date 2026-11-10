/**
 * Coursebook background worker. Run with:  npm run worker
 *
 * It waits for jobs in Redis and does the slow work (reading PDFs, OCR,
 * building outlines) outside the web app, so the website stays fast and
 * long jobs aren't cut off by web-server time limits.
 */
import { UnrecoverableError, Worker } from "bullmq";
import { env } from "@/server/env";
import {
  EMBED_BOOK_QUEUE,
  EMBED_QUERY_QUEUE,
  enqueueBookEmbedding,
  enqueueGeneration,
  GENERATE_QUEUE,
  PROCESS_BOOK_QUEUE,
  REMINDERS_QUEUE,
  redisConnection,
  type EmbedBookPayload,
  type EmbedQueryPayload,
  type GeneratePayload,
  type ProcessBookPayload,
} from "@/server/queue";
import { LocalEmbedder } from "@/server/embeddings/local";
import { booksNeedingEmbeddings, embedBook } from "@/server/embeddings/book";
import { Queue } from "bullmq";
import { sendDueReminders } from "@/server/reminders";
import { runProgramJobs } from "@/server/program-jobs";
import { recordError } from "@/server/monitoring";
import { runMaintenance } from "@/server/maintenance";
import { claudeEnabled } from "@/server/env";
import { getBatchRunner, getWriter, generationModel } from "@/server/ai/client";
import { AiError } from "@/server/ai/writer";
import { markLessonFailed, runFlashcardsJob, runLessonJob, runQuestionsJob } from "@/server/generation/run";
import { batchJobFailed, pollBatch, pollDelayMs, submitAssessmentBatch, submitLessonBatch } from "@/server/generation/batch";
import { markAssessmentFailed, runAssessmentJob } from "@/server/generation/assessments";
import { renderPagePng } from "@/server/processing/page-images";
import { markWorksheetFailed } from "@/server/worksheets";
import { runWorksheetJob } from "@/server/worksheet-job";
import { OcrPool } from "@/server/processing/ocr";
import { runProcessBookJob } from "@/server/processing/run-job";
import { db } from "@/server/db";

const ocr = new OcrPool(env.OCR_WORKERS);

const worker = new Worker<ProcessBookPayload>(
  PROCESS_BOOK_QUEUE,
  async (job) => {
    const maxAttempts = job.opts.attempts ?? 1;
    const outcome = await runProcessBookJob(
      { jobId: job.data.jobId, bookId: job.data.bookId, attempt: job.attemptsMade + 1, maxAttempts },
      { ocr },
    );
    // Throwing tells BullMQ to schedule another attempt (with backoff).
    if (outcome === "retry") throw new Error("retrying after unexpected error");
    if (outcome === "failed") throw new UnrecoverableError("failed (see Job row)");
    // Prepare the book for the tutor in the background (doesn't hold up the course page).
    if (outcome === "done") await enqueueBookEmbedding(job.data.bookId);
  },
  {
    connection: redisConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    // Long OCR runs: renew the job lock regularly so it isn't treated as stalled.
    lockDuration: 5 * 60_000,
  },
);

worker.on("ready", () => console.info(`[worker] ready (concurrency ${env.WORKER_CONCURRENCY}, OCR workers ${env.OCR_WORKERS})`));

/**
 * Lesson generation. Several lessons are written at once (GENERATION_CONCURRENCY).
 * Temporary problems (Claude busy, network) are retried with growing waits;
 * anything else marks the lesson as failed with a message for the student.
 */
const generator = new Worker<GeneratePayload>(
  GENERATE_QUEUE,
  async (job) => {
    const data = job.data;
    const deps = { writer: getWriter(), ...generationModel(), renderPage: renderPagePng };

    // Whole-course generation through the Batch API (half price).
    if (data.kind === "batch-poll") {
      const runner = getBatchRunner();
      try {
        const state = await pollBatch(data, { ...deps, runner });
        if (state === "waiting") {
          const attempt = data.attempt + 1;
          await enqueueGeneration([{ payload: { ...data, attempt }, priority: 1, delayMs: pollDelayMs(runner, attempt) }]);
        }
        console.info(`[batch] ${data.batchId}: ${state}`);
      } catch (err) {
        // Claude or the database briefly unavailable: check again later (saved results are never saved twice).
        console.error(`[batch] checking ${data.batchId} failed, will check again:`, err instanceof Error ? err.message : err);
        const attempt = data.attempt + 1;
        await enqueueGeneration([{ payload: { ...data, attempt }, priority: 1, delayMs: pollDelayMs(runner, attempt) }]);
      }
      return;
    }
    if (data.kind === "lesson-batch" || data.kind === "assessment-batch") {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      try {
        const runner = getBatchRunner();
        const batchId = data.kind === "lesson-batch" ? await submitLessonBatch(data, { ...deps, runner }) : await submitAssessmentBatch(data, { ...deps, runner });
        console.info(`[batch] ${data.kind} for course ${data.courseId}: ${batchId ?? "nothing to send"}`);
      } catch (err) {
        console.error(`[batch] ${data.kind} for course ${data.courseId} attempt ${job.attemptsMade + 1} failed:`, err instanceof Error ? err.message : err);
        const ai = err instanceof AiError ? err : null;
        if ((!ai || ai.kind === "retryable") && !lastAttempt) throw err;
        await batchJobFailed(data); // write them one at a time instead
        throw new UnrecoverableError(ai?.userMessage ?? "Couldn't send the batch.");
      }
      return;
    }

    // A teacher's worksheet: Claude lists its questions.
    if (data.kind === "worksheet") {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      try {
        console.info(`[worksheet] ${data.worksheetId}: ${await runWorksheetJob(data, deps)}`);
      } catch (err) {
        const ai = err instanceof AiError ? err : null;
        console.error(`[worksheet] ${data.worksheetId} attempt ${job.attemptsMade + 1} failed:`, err instanceof Error ? err.message : err);
        if ((!ai || ai.kind === "retryable") && !lastAttempt) throw err;
        await markWorksheetFailed(data.worksheetId, ai?.userMessage ?? "Something went wrong reading this worksheet. Try again.");
        throw new UnrecoverableError("worksheet failed");
      }
      return;
    }

    const id = data.kind === "assessment" ? data.assessmentId : data.lessonId;
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      const outcome =
        data.kind === "assessment"
          ? await runAssessmentJob(data, deps)
          : data.kind === "questions"
            ? await runQuestionsJob(data, deps)
            : data.kind === "flashcards"
              ? await runFlashcardsJob(data, deps)
              : await runLessonJob(data, deps);
      console.info(`[generate] ${data.kind} ${id}: ${outcome}`);
    } catch (err) {
      const ai = err instanceof AiError ? err : null;
      const retryable = !ai || ai.kind === "retryable";
      const message = ai?.userMessage ?? "Something went wrong while writing this. Please try again.";
      console.error(`[generate] ${data.kind} ${id} attempt ${job.attemptsMade + 1} failed:`, err instanceof Error ? err.message : err);
      if (retryable && !lastAttempt) throw err; // BullMQ will try again after a wait
      if (data.kind === "assessment") await markAssessmentFailed(id, message);
      else if (data.kind !== "flashcards") await markLessonFailed(id, message); // a lesson without cards is still a lesson
      throw new UnrecoverableError(message);
    }
  },
  { connection: redisConnection(), concurrency: env.GENERATION_CONCURRENCY, lockDuration: 10 * 60_000 },
);
generator.on("ready", () =>
  console.info(`[worker] generation ready (concurrency ${env.GENERATION_CONCURRENCY}${claudeEnabled ? "" : ", NO ANTHROPIC_API_KEY: lessons will fail"})`),
);
generator.on("error", (err) => console.error("[worker] generation error:", err.message));
/**
 * Embeddings for the "Ask the book" tutor (Phase 7). One model instance is
 * shared: whole books in the background, and questions from the tutor, which
 * the web app waits for (a few milliseconds each once the model is loaded).
 */
const embedder = new LocalEmbedder({ cacheDir: env.EMBEDDINGS_CACHE_DIR });
const bookEmbedder = new Worker<EmbedBookPayload>(
  EMBED_BOOK_QUEUE,
  async (job) => {
    const t0 = Date.now();
    const n = await embedBook(job.data.bookId, embedder);
    console.info(`[embed] book ${job.data.bookId}: ${n} passages in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  },
  { connection: redisConnection(), concurrency: 1, lockDuration: 10 * 60_000 },
);
const queryEmbedder = new Worker<EmbedQueryPayload>(EMBED_QUERY_QUEUE, async (job) => embedder.embedQuery(job.data.text), {
  connection: redisConnection(),
  concurrency: 4,
});
bookEmbedder.on("error", (err) => console.error("[worker] embed error:", err.message));
queryEmbedder.on("error", (err) => console.error("[worker] embed-query error:", err.message));
queryEmbedder.on("ready", async () => {
  // Load the model now, so the first question doesn't wait for it; then catch up on older books.
  try {
    await embedder.embedQuery("warm up");
    const pending = await booksNeedingEmbeddings();
    for (const bookId of pending) await enqueueBookEmbedding(bookId);
    console.info(`[worker] embeddings ready${pending.length ? `, ${pending.length} book(s) queued for embedding` : ""}`);
  } catch (err) {
    console.error("[worker] couldn't load the embedding model (the tutor will use keyword search):", err instanceof Error ? err.message : err);
  }
});

/**
 * Scheduled jobs: daily study reminder emails, checked every 15 minutes (each
 * student gets at most one a day, at their chosen hour), and hourly housekeeping.
 */
const reminders = new Worker(
  REMINDERS_QUEUE,
  async (job) => {
    if (job.name === "program") {
      const r = await runProgramJobs();
      if (r.digests + r.summaries > 0) console.info("[program jobs]", r);
      return;
    }
    if (job.name === "maintenance") {
      const r = await runMaintenance();
      if (r.uploads + r.rateRows + r.events + r.verifications > 0) console.info("[maintenance]", r);
      return;
    }
    const n = await sendDueReminders();
    if (n > 0) console.info(`[reminders] sent ${n}`);
  },
  { connection: redisConnection(), concurrency: 1 },
);
reminders.on("error", (err) => console.error("[worker] reminders error:", err.message));
const scheduled = new Queue(REMINDERS_QUEUE, { connection: redisConnection() });
void scheduled
  .upsertJobScheduler("every-15-minutes", { every: 15 * 60_000 }, { name: "check", opts: { removeOnComplete: true, removeOnFail: 50 } })
  .catch((err) => console.error("[worker] couldn't schedule reminders:", err.message));
void scheduled
  .upsertJobScheduler("hourly-program-jobs", { every: 60 * 60_000 }, { name: "program", opts: { removeOnComplete: true, removeOnFail: 50 } })
  .catch((err) => console.error("[worker] couldn't schedule program jobs:", err.message));
void scheduled
  .upsertJobScheduler("hourly-maintenance", { every: 60 * 60_000 }, { name: "maintenance", opts: { removeOnComplete: true, removeOnFail: 50 } })
  .catch((err) => console.error("[worker] couldn't schedule maintenance:", err.message));

worker.on("active", (job) => console.info(`[worker] started job ${job.id} (book ${job.data.bookId})`));
worker.on("completed", (job) => console.info(`[worker] finished job ${job.id}`));
worker.on("error", (err) => console.error("[worker] error:", err.message));
// Failed jobs go to the error log (and the site admins' inbox), by job type only.
worker.on("failed", (job, err) => {
  void recordError({ kind: "worker", message: err?.message ?? "Job failed", path: `worker:${job?.name ?? "job"}` }).catch(() => {});
});

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, finishing current job…`);
  await Promise.all([worker.close(), generator.close(), bookEmbedder.close(), queryEmbedder.close(), reminders.close()]);
  await ocr.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
