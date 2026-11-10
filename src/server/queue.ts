import "server-only";
import { Queue, QueueEvents } from "bullmq";
import { EMBEDDING_MODEL } from "@/lib/tutor/embedding";
import type { QueryEmbedder } from "./embeddings/types";
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
export type GeneratePayload =
  | {
      kind: "lesson" | "questions" | "flashcards";
      lessonId: string;
      /** Regenerate even if the cached lesson is up to date (the student asked). */
      force?: boolean;
      /** Generate even if the pages look too thin (the student chose "Try anyway"). */
      allowThin?: boolean;
    }
  | { kind: "assessment"; assessmentId: string }
  /** Prepare these lessons and send them to Claude as one batch (half price). */
  | { kind: "lesson-batch"; courseId: string; lessonIds: string[]; force?: boolean }
  /** Send these unit tests / the final exam as one batch. */
  | { kind: "assessment-batch"; courseId: string; assessmentIds: string[] }
  /** Check a submitted batch; save its results when it's done. */
  | { kind: "batch-poll"; batchId: string; attempt: number };

/** A readable id for a generation job (one per lesson/assessment, so nothing is queued twice). */
export function generationJobId(payload: GeneratePayload): string {
  switch (payload.kind) {
    case "assessment":
      return `assessment-${payload.assessmentId}`;
    case "lesson-batch":
    case "assessment-batch":
      return `${payload.kind}-${payload.courseId}-${Date.now()}`;
    case "batch-poll":
      return `batch-poll-${payload.batchId}-${payload.attempt}`;
    default:
      return `${payload.kind}-${payload.lessonId}`;
  }
}

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
export async function enqueueGeneration(jobs: { payload: GeneratePayload; priority: number; delayMs?: number }[]) {
  if (jobs.length === 0) return;
  await getGenerateQueue().addBulk(
    jobs.map(({ payload, priority, delayMs }) => ({
      name: payload.kind,
      data: payload,
      opts: {
        jobId: generationJobId(payload),
        ...(delayMs ? { delay: delayMs } : {}),
        priority: Math.max(1, Math.min(2_000_000, priority)),
      },
    })),
  );
}

// ─── Embeddings (Phase 7) ────────────────────────────────────────────────
// The embedding model lives in the worker only. Books are embedded in the
// background; questions are embedded on request (the web app waits briefly).

export const EMBED_BOOK_QUEUE = "embed-book";
export type EmbedBookPayload = { bookId: string };
export const EMBED_QUERY_QUEUE = "embed-query";
export type EmbedQueryPayload = { text: string };

let embedBookQueue: Queue<EmbedBookPayload> | null = null;
function getEmbedBookQueue() {
  embedBookQueue ??= new Queue<EmbedBookPayload>(EMBED_BOOK_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
  });
  return embedBookQueue;
}

/** Queue a book for embedding (no-op if it's already waiting). */
export async function enqueueBookEmbedding(bookId: string) {
  await getEmbedBookQueue().add("embed", { bookId }, { jobId: `embed-${bookId}` });
}

let embedQueryQueue: Queue<EmbedQueryPayload> | null = null;
let embedQueryEvents: QueueEvents | null = null;

/**
 * Embeds a question by asking the worker. Returns null if the worker doesn't
 * answer in time (not running, still loading the model, or busy), and the
 * tutor falls back to keyword search for that question.
 */
export const workerQueryEmbedder: QueryEmbedder = {
  model: EMBEDDING_MODEL,
  async embedQuery(text: string) {
    try {
      embedQueryQueue ??= new Queue<EmbedQueryPayload>(EMBED_QUERY_QUEUE, {
        connection: redisConnection(),
        defaultJobOptions: { attempts: 1, removeOnComplete: { age: 60 }, removeOnFail: { age: 60 } },
      });
      embedQueryEvents ??= new QueueEvents(EMBED_QUERY_QUEUE, { connection: redisConnection() });
      const job = await embedQueryQueue.add("q", { text: text.slice(0, 2_000) });
      const vector = (await job.waitUntilFinished(embedQueryEvents, 4_000)) as number[];
      return Array.isArray(vector) ? vector : null;
    } catch (err) {
      console.warn("[tutor] question embedding unavailable, using keyword search:", err instanceof Error ? err.message : err);
      return null;
    }
  },
};

// ─── Daily reminders (Phase 8) ──────────────────────────────────────────
export const REMINDERS_QUEUE = "reminders";
