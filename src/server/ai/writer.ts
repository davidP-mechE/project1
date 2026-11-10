import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  FlashcardsDraftSchema,
  LessonDraftSchema,
  QuestionsDraftSchema,
  type FlashcardsDraft,
  type LessonDraft,
  type QuestionsDraft,
} from "@/lib/ai/lesson-schema";
import {
  flashcardsTask,
  LESSON_SYSTEM_PROMPT,
  lessonTask,
  PAGE_REPAIR_PROMPT,
  questionsTask,
  SLIDE_READ_PROMPT,
  sourceBlock,
  type LessonPromptInput,
} from "@/lib/ai/prompts";
import type { TokenUsage } from "@/lib/ai/models";
import {
  ASSESSMENT_SYSTEM_PROMPT,
  AssessmentDraftSchema,
  assessmentUserMessage,
  type AssessmentDraft,
  type AssessmentPromptInput,
} from "@/lib/ai/assessment";

/**
 * Everything that talks to Claude goes through a "writer". The real one
 * (ClaudeWriter) calls the API; tests use a fake one, so the test suite never
 * spends money or needs a network connection.
 */

/** One billed API call. `batch`: sent through the Message Batches API (half price). */
export type Call<T> = {
  value: T;
  model: string;
  usage: TokenUsage;
  batch?: boolean;
};
/** One generation can take more than one API call (e.g. a retry on another model); each is billed. */
export type WriterResult<T> = { value: T; calls: Call<unknown>[] };

export interface LessonWriter {
  writeLesson(input: LessonPromptInput): Promise<WriterResult<LessonDraft>>;
  /** Flashcards for a lesson, from its pages (a separate, cheaper request than the lesson). */
  writeFlashcards(
    input: LessonPromptInput,
  ): Promise<WriterResult<FlashcardsDraft>>;
  writeQuestions(
    input: LessonPromptInput & { avoid: string[] },
  ): Promise<WriterResult<QuestionsDraft>>;
  /** Re-read a page from its image: an equation-heavy book page, or a slide that is mostly pictures. */
  repairPage(
    png: Buffer,
    kind?: "book" | "slides",
  ): Promise<WriterResult<string>>;
  /** A unit summary + unit test, or the final exam, from finished lessons. */
  writeAssessment(
    input: AssessmentPromptInput,
  ): Promise<WriterResult<AssessmentDraft>>;
}

/** Why a call failed, and whether trying again later could help. */
export class AiError extends Error {
  constructor(
    readonly kind:
      | "retryable"
      | "config"
      | "refused"
      | "too_long"
      | "invalid"
      | "limit",
    readonly userMessage: string,
    detail?: string,
    readonly calls: Call<unknown>[] = [],
  ) {
    super(detail ?? userMessage);
  }
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type WriterConfig = {
  /** Lessons, practice questions, unit tests and the final exam. */
  model: string;
  /** Tried once when a model declines a request. */
  fallbackModel: string;
  /** Flashcards: short term/answer cards, a simple job for a small model. */
  flashcardModel: string;
  flashcardEffort: Effort;
  /** Transcribing page and slide images. */
  visionModel: string;
  effort: Effort;
};

/** The structured (JSON) jobs a writer does. The same request goes out directly or inside a batch. */
export type StructuredJob =
  | { kind: "lesson"; input: LessonPromptInput }
  | { kind: "flashcards"; input: LessonPromptInput }
  | { kind: "questions"; input: LessonPromptInput & { avoid: string[] } }
  | { kind: "assessment"; input: AssessmentPromptInput };
export type StructuredKind = StructuredJob["kind"];

const SPECS = {
  lesson: {
    schema: LessonDraftSchema,
    maxTokens: 32_000,
    system: LESSON_SYSTEM_PROMPT,
    what: "lesson",
  },
  flashcards: {
    schema: FlashcardsDraftSchema,
    maxTokens: 8_000,
    system: LESSON_SYSTEM_PROMPT,
    what: "lesson's flashcards",
  },
  questions: {
    schema: QuestionsDraftSchema,
    maxTokens: 16_000,
    system: LESSON_SYSTEM_PROMPT,
    what: "lesson's questions",
  },
  assessment: {
    schema: AssessmentDraftSchema,
    maxTokens: 24_000,
    system: ASSESSMENT_SYSTEM_PROMPT,
    what: "test",
  },
} as const;

const REPAIR_MAX_TOKENS = 8_000;

export function usageOf(u: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Turn SDK errors into AiErrors. Most specific first. */
function classify(err: unknown, calls: Call<unknown>[]): AiError {
  if (err instanceof AiError) return err;
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiError(
      "config",
      "Lesson generation isn't set up correctly on the server (the Claude API key was rejected).",
      err.message,
      calls,
    );
  }
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  ) {
    // 429, 5xx (including 529 overloaded) and network problems usually pass: try again later.
    return new AiError(
      "retryable",
      "Claude is busy right now. We'll keep trying automatically.",
      err.message,
      calls,
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError(
      "invalid",
      "Claude couldn't process this lesson's text.",
      err.message,
      calls,
    );
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(
      "retryable",
      "Something went wrong talking to Claude. We'll try again.",
      `${err.status}: ${err.message}`,
      calls,
    );
  }
  return new AiError(
    "retryable",
    "Something went wrong talking to Claude. We'll try again.",
    String(err),
    calls,
  );
}

const text = (t: string, cache = false): Anthropic.TextBlockParam =>
  cache
    ? { type: "text", text: t, cache_control: { type: "ephemeral" } }
    : { type: "text", text: t };

export class ClaudeWriter implements LessonWriter {
  constructor(
    private readonly client: Anthropic,
    private readonly config: WriterConfig,
  ) {}

  modelFor(kind: StructuredKind) {
    return kind === "flashcards"
      ? this.config.flashcardModel
      : this.config.model;
  }

  /**
   * The request for a job, ready to send directly or inside a batch.
   * The system prompt never changes, so it's cached across every lesson. The
   * source pages come next, in their own block; for new questions and Review
   * drills (the same pages, sent again and again) that block is cached too.
   */
  request(
    job: StructuredJob,
    model = this.modelFor(job.kind),
  ): Anthropic.MessageCreateParamsNonStreaming {
    const spec = SPECS[job.kind];
    const content: Anthropic.TextBlockParam[] =
      job.kind === "assessment"
        ? [text(assessmentUserMessage(job.input))]
        : job.kind === "lesson"
          ? [text(sourceBlock(job.input)), text(lessonTask(job.input))]
          : job.kind === "flashcards"
            ? [text(sourceBlock(job.input)), text(flashcardsTask(job.input))]
            : [
                text(sourceBlock(job.input), true),
                text(questionsTask(job.input)),
              ];
    return {
      model,
      max_tokens: spec.maxTokens,
      system: [text(spec.system, true)],
      messages: [{ role: "user", content }],
      output_config: {
        format: zodOutputFormat(spec.schema),
        effort:
          job.kind === "flashcards" && model === this.config.flashcardModel
            ? this.config.flashcardEffort
            : this.config.effort,
      },
    };
  }

  /** Read a finished reply (from a direct request or a batch). Throws an AiError if it can't be used. */
  read<T>(
    kind: StructuredKind,
    message: Anthropic.Message,
    calls: Call<unknown>[],
  ): T {
    const spec = SPECS[kind];
    if (message.stop_reason === "refusal") {
      throw new AiError(
        "refused",
        `Claude declined to write this ${spec.what}. This sometimes happens with sensitive topics. You can edit it by hand or try regenerating it.`,
        "refusal",
        calls,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new AiError(
        "too_long",
        "This lesson is too long to write in one go. Split it into smaller lessons in the outline editor, then try again.",
        `stop_reason max_tokens at ${spec.maxTokens}`,
        calls,
      );
    }
    const reply = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return zodOutputFormat(spec.schema).parse(reply) as T;
    } catch (err) {
      throw new AiError(
        "retryable",
        "Claude's reply couldn't be read. We'll try again.",
        `unparseable ${kind} reply: ${String(err).slice(0, 200)}`,
        calls,
      );
    }
  }

  /**
   * Send a job and read the reply. If the model declines (a "refusal"), retry
   * once on the fallback model; textbooks occasionally touch topics
   * (chemistry, security…) that a safety filter misreads.
   */
  async run<T>(job: StructuredJob): Promise<WriterResult<T>> {
    const calls: Call<unknown>[] = [];
    for (const model of [this.modelFor(job.kind), this.config.fallbackModel]) {
      let response: Anthropic.Message;
      try {
        // Streamed: long replies would otherwise hit the SDK's 10-minute limit for
        // non-streaming requests. finalMessage() waits for the whole reply.
        response = await this.client.messages
          .stream(this.request(job, model))
          .finalMessage();
      } catch (err) {
        throw classify(err, calls);
      }
      calls.push({
        value: null,
        model: response.model ?? model,
        usage: usageOf(response.usage),
      });
      if (
        response.stop_reason === "refusal" &&
        model !== this.config.fallbackModel
      )
        continue; // try the fallback model
      return { value: this.read<T>(job.kind, response, calls), calls };
    }
    throw new AiError(
      "refused",
      "Claude declined to write this. You can edit it by hand or try regenerating it.",
      "refusal on primary and fallback model",
      calls,
    );
  }

  writeLesson(input: LessonPromptInput) {
    return this.run<LessonDraft>({ kind: "lesson", input });
  }

  writeFlashcards(input: LessonPromptInput) {
    return this.run<FlashcardsDraft>({ kind: "flashcards", input });
  }

  writeQuestions(input: LessonPromptInput & { avoid: string[] }) {
    return this.run<QuestionsDraft>({ kind: "questions", input });
  }

  writeAssessment(input: AssessmentPromptInput) {
    return this.run<AssessmentDraft>({ kind: "assessment", input });
  }

  async repairPage(
    png: Buffer,
    kind: "book" | "slides" = "book",
  ): Promise<WriterResult<string>> {
    const calls: Call<unknown>[] = [];
    let response;
    try {
      response = await this.client.messages
        .stream({
          model: this.config.visionModel,
          max_tokens: REPAIR_MAX_TOKENS,
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: png.toString("base64"),
                  },
                },
                {
                  type: "text",
                  text:
                    kind === "slides" ? SLIDE_READ_PROMPT : PAGE_REPAIR_PROMPT,
                },
              ],
            },
          ],
        })
        .finalMessage();
    } catch (err) {
      throw classify(err, calls);
    }
    calls.push({
      value: null,
      model: response.model ?? this.config.visionModel,
      usage: usageOf(response.usage),
    });
    if (response.stop_reason === "refusal") {
      throw new AiError(
        "refused",
        "Claude declined to read this page.",
        "refusal",
        calls,
      );
    }
    const out = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { value: out, calls };
  }
}
