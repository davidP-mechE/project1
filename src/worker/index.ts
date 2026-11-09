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
  GENERATE_QUEUE,
  PROCESS_BOOK_QUEUE,
  redisConnection,
  type EmbedBookPayload,
  type EmbedQueryPayload,
  type GeneratePayload,
  type ProcessBookPayload,
} from "@/server/queue";
import { LocalEmbedder } from "@/server/embeddings/local";
import { booksNeedingEmbeddings, embedBook } from "@/server/embeddings/book";
import { claudeEnabled } from "@/server/env";
import { getWriter, generationModel } from "@/server/ai/client";
import { AiError } from "@/server/ai/writer";
import { markLessonFailed, runLessonJob, runQuestionsJob } from "@/server/generation/run";
import { renderPagePng } from "@/server/processing/page-images";
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
    const { lessonId, kind } = job.data;
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      const deps = { writer: getWriter(), ...generationModel(), renderPage: renderPagePng };
      const outcome = kind === "questions" ? await runQuestionsJob(job.data, deps) : await runLessonJob(job.data, deps);
      console.info(`[generate] ${kind} ${lessonId}: ${outcome}`);
    } catch (err) {
      const ai = err instanceof AiError ? err : null;
      const retryable = !ai || ai.kind === "retryable";
      const message = ai?.userMessage ?? "Something went wrong while writing this lesson. Please try again.";
      console.error(`[generate] ${kind} ${lessonId} attempt ${job.attemptsMade + 1} failed:`, err instanceof Error ? err.message : err);
      if (retryable && !lastAttempt) throw err; // BullMQ will try again after a wait
      await markLessonFailed(lessonId, message);
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

worker.on("active", (job) => console.info(`[worker] started job ${job.id} (book ${job.data.bookId})`));
worker.on("completed", (job) => console.info(`[worker] finished job ${job.id}`));
worker.on("error", (err) => console.error("[worker] error:", err.message));

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, finishing current job…`);
  await Promise.all([worker.close(), generator.close(), bookEmbedder.close(), queryEmbedder.close()]);
  await ocr.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
