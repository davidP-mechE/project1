import "server-only";
import { Queue } from "bullmq";
import { db } from "./db";
import { env } from "./env";

/**
 * The job queue lives in Redis (BullMQ). The web app only ADDS jobs; the
 * separate worker process (src/worker) picks them up and does the heavy work.
 * Each queue job has a matching `Job` row so pages can show live status.
 */

export const PROCESS_BOOK_QUEUE = "process-book";
export type ProcessBookPayload = { jobId: string; bookId: string };

export const GENERATE_QUEUE = "generate";
export type GeneratePayload = {
  kind: "lesson" | "questions";
  lessonId: string;
  /** Regenerate even if the cached lesson is up to date (the student asked). */
  force?: boolean;
  /** Generate even if the pages look too thin (the student chose "Try anyway"). */
  allowThin?: boolean;
};

export function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
}

let processBookQueue: Queue<ProcessBookPayload> | null = null;
function getProcessBookQueue() {
  processBookQueue ??= new Queue<ProcessBookPayload>(PROCESS_BOOK_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 2, // one automatic retry for unexpected errors
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
  return processBookQueue;
}

/** Create a Job row and put the book in the processing queue. */
export async function enqueueBookProcessing(input: { userId: string; bookId: string; courseId: string }) {
  const job = await db.job.create({
    data: {
      userId: input.userId,
      bookId: input.bookId,
      courseId: input.courseId,
      type: "PROCESS_BOOK",
      message: "Waiting to start…",
    },
  });
  await getProcessBookQueue().add("process", { jobId: job.id, bookId: input.bookId }, { jobId: job.id });
  return job;
}

let generateQueue: Queue<GeneratePayload> | null = null;
function getGenerateQueue() {
  generateQueue ??= new Queue<GeneratePayload>(GENERATE_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 4, // Claude can be briefly busy (rate limits, overload): retry with growing waits
      backoff: { type: "exponential", delay: 20_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return generateQueue;
}

/**
 * Queue lessons for generation. `priority`: lower runs sooner, so lessons are
 * written in course order, and a lesson the student is waiting on jumps ahead.
 * The job id makes a lesson that's already waiting in the queue not get added twice.
 */
export async function enqueueGeneration(jobs: { payload: GeneratePayload; priority: number }[]) {
  if (jobs.length === 0) return;
  await getGenerateQueue().addBulk(
    jobs.map(({ payload, priority }) => ({
      name: payload.kind,
      data: payload,
      opts: { jobId: `${payload.kind}-${payload.lessonId}`, priority: Math.max(1, Math.min(2_000_000, priority)) },
    })),
  );
}
