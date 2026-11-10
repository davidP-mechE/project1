import type Anthropic from "@anthropic-ai/sdk";
import {
  AiError,
  usageOf,
  type Call,
  type ClaudeWriter,
  type LessonWriter,
  type StructuredJob,
  type StructuredKind,
} from "./writer";

/**
 * Sending many requests at once through Claude's Message Batches API: half
 * the price of sending them one by one, in exchange for waiting (most batches
 * finish within an hour; at most 24 hours). Used for whole-course generation,
 * where nobody is waiting on any single lesson.
 */

export type BatchItem = { customId: string; job: StructuredJob };

export type BatchResult =
  | { customId: string; ok: true; value: unknown; calls: Call<unknown>[] }
  /** `error` says why (refused, too long, unreadable); null when the request itself errored or expired (nothing billed). */
  | {
      customId: string;
      ok: false;
      error: AiError | null;
      detail: string;
      calls: Call<unknown>[];
    };

export interface BatchRunner {
  /** How long to wait before the first check. */
  readonly firstPollMs: number;
  submit(items: BatchItem[]): Promise<string>;
  isDone(batchId: string): Promise<boolean>;
  /** Results in any order. `kindOf` says what each custom_id was for, to read its reply. */
  results(
    batchId: string,
    kindOf: (customId: string) => StructuredKind | null,
  ): AsyncIterable<BatchResult>;
}

export class ClaudeBatchRunner implements BatchRunner {
  readonly firstPollMs = 60_000;
  constructor(
    private readonly client: Anthropic,
    private readonly writer: ClaudeWriter,
  ) {}

  async submit(items: BatchItem[]) {
    const batch = await this.client.messages.batches.create({
      requests: items.map((i) => ({
        custom_id: i.customId,
        params: this.writer.request(i.job),
      })),
    });
    return batch.id;
  }

  async isDone(batchId: string) {
    const batch = await this.client.messages.batches.retrieve(batchId);
    return batch.processing_status === "ended";
  }

  async *results(
    batchId: string,
    kindOf: (customId: string) => StructuredKind | null,
  ): AsyncIterable<BatchResult> {
    for await (const r of await this.client.messages.batches.results(batchId)) {
      const kind = kindOf(r.custom_id);
      if (!kind) continue;
      if (r.result.type !== "succeeded") {
        // errored / canceled / expired: not billed; the caller sends it again on its own.
        const detail =
          r.result.type === "errored"
            ? `errored: ${r.result.error.error.type}`
            : r.result.type;
        yield {
          customId: r.custom_id,
          ok: false,
          error: null,
          detail,
          calls: [],
        };
        continue;
      }
      const message = r.result.message;
      const calls: Call<unknown>[] = [
        {
          value: null,
          model: message.model,
          usage: usageOf(message.usage),
          batch: true,
        },
      ];
      try {
        yield {
          customId: r.custom_id,
          ok: true,
          value: this.writer.read(kind, message, calls),
          calls,
        };
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        yield {
          customId: r.custom_id,
          ok: false,
          error: err,
          detail: err.message,
          calls,
        };
      }
    }
  }
}

/**
 * A stand-in for the Batch API (demo mode and tests): "submitting" just
 * remembers the requests, the batch is done straight away, and the results
 * come from the demo/fake writer.
 */
export class InstantBatchRunner implements BatchRunner {
  readonly firstPollMs = 1_000;
  private static batches = new Map<string, BatchItem[]>();
  submitted: BatchItem[][] = [];
  constructor(private readonly writer: LessonWriter) {}

  async submit(items: BatchItem[]) {
    const id = `instantbatch_${crypto.randomUUID().replace(/-/g, "")}`;
    InstantBatchRunner.batches.set(id, items);
    this.submitted.push(items);
    return id;
  }

  async isDone() {
    return true;
  }

  async *results(batchId: string): AsyncIterable<BatchResult> {
    for (const { customId, job } of InstantBatchRunner.batches.get(batchId) ??
      []) {
      try {
        const res =
          job.kind === "lesson"
            ? await this.writer.writeLesson(job.input)
            : job.kind === "flashcards"
              ? await this.writer.writeFlashcards(job.input)
              : job.kind === "questions"
                ? await this.writer.writeQuestions(job.input)
                : await this.writer.writeAssessment(job.input);
        yield {
          customId,
          ok: true,
          value: res.value,
          calls: res.calls.map((c) => ({ ...c, batch: true })),
        };
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        yield {
          customId,
          ok: false,
          error: err,
          detail: err.message,
          calls: err.calls.map((c) => ({ ...c, batch: true })),
        };
      }
    }
    InstantBatchRunner.batches.delete(batchId);
  }
}
