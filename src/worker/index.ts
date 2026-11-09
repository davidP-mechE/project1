/**
 * Coursebook background worker. Run with:  npm run worker
 *
 * It waits for jobs in Redis and does the slow work (reading PDFs, OCR,
 * building outlines) outside the web app, so the website stays fast and
 * long jobs aren't cut off by web-server time limits.
 */
import { UnrecoverableError, Worker } from "bullmq";
import { env } from "@/server/env";
import { PROCESS_BOOK_QUEUE, redisConnection, type ProcessBookPayload } from "@/server/queue";
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
  },
  {
    connection: redisConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    // Long OCR runs: renew the job lock regularly so it isn't treated as stalled.
    lockDuration: 5 * 60_000,
  },
);

worker.on("ready", () => console.info(`[worker] ready (concurrency ${env.WORKER_CONCURRENCY}, OCR workers ${env.OCR_WORKERS})`));
worker.on("active", (job) => console.info(`[worker] started job ${job.id} (book ${job.data.bookId})`));
worker.on("completed", (job) => console.info(`[worker] finished job ${job.id}`));
worker.on("error", (err) => console.error("[worker] error:", err.message));

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, finishing current job…`);
  await worker.close();
  await ocr.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
