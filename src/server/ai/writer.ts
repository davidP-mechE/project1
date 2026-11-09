import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LessonDraftSchema, QuestionsDraftSchema, type LessonDraft, type QuestionsDraft } from "@/lib/ai/lesson-schema";
import {
  LESSON_SYSTEM_PROMPT,
  lessonUserMessage,
  PAGE_REPAIR_PROMPT,
  questionsUserMessage,
  type LessonPromptInput,
} from "@/lib/ai/prompts";
import type { TokenUsage } from "@/lib/ai/models";
import { ASSESSMENT_SYSTEM_PROMPT, AssessmentDraftSchema, assessmentUserMessage, type AssessmentDraft, type AssessmentPromptInput } from "@/lib/ai/assessment";

/**
 * Everything that talks to Claude goes through a "writer". The real one
 * (ClaudeWriter) calls the API; tests use a fake one, so the test suite never
 * spends money or needs a network connection.
 */

export type Call<T> = { value: T; model: string; usage: TokenUsage };
/** One generation can take more than one API call (e.g. a retry on another model); each is billed. */
export type WriterResult<T> = { value: T; calls: Call<unknown>[] };

export interface LessonWriter {
  writeLesson(input: LessonPromptInput): Promise<WriterResult<LessonDraft>>;
  writeQuestions(input: LessonPromptInput & { avoid: string[] }): Promise<WriterResult<QuestionsDraft>>;
  /** Transcribe a page image (PNG) with math as LaTeX. */
  repairPage(png: Buffer): Promise<WriterResult<string>>;
  /** A unit summary + unit test, or the final exam, from finished lessons. */
  writeAssessment(input: AssessmentPromptInput): Promise<WriterResult<AssessmentDraft>>;
}

/** Why a call failed, and whether trying again later could help. */
export class AiError extends Error {
  constructor(
    readonly kind: "retryable" | "config" | "refused" | "too_long" | "invalid" | "limit",
    readonly userMessage: string,
    detail?: string,
    readonly calls: Call<unknown>[] = [],
  ) {
    super(detail ?? userMessage);
  }
}

export type WriterConfig = {
  model: string;
  fallbackModel: string;
  visionModel: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
};

const LESSON_MAX_TOKENS = 32_000;
const QUESTIONS_MAX_TOKENS = 16_000;
const REPAIR_MAX_TOKENS = 8_000;

function usageOf(u: Anthropic.Usage): TokenUsage {
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
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("config", "Lesson generation isn't set up correctly on the server (the Claude API key was rejected).", err.message, calls);
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    // 429, 5xx (including 529 overloaded) and network problems usually pass: try again later.
    return new AiError("retryable", "Claude is busy right now. We'll keep trying automatically.", err.message, calls);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError("invalid", "Claude couldn't process this lesson's text.", err.message, calls);
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError("retryable", "Something went wrong talking to Claude. We'll try again.", `${err.status}: ${err.message}`, calls);
  }
  return new AiError("retryable", "Something went wrong talking to Claude. We'll try again.", String(err), calls);
}

export class ClaudeWriter implements LessonWriter {
  constructor(
    private readonly client: Anthropic,
    private readonly config: WriterConfig,
  ) {}

  /**
   * Run a structured-output request. If the model declines (a "refusal"),
   * retry once on the fallback model; textbooks occasionally touch topics
   * (chemistry, security…) that a safety filter misreads.
   */
  private async structured<T>(
    schema: Parameters<typeof zodOutputFormat>[0],
    userMessage: string,
    maxTokens: number,
    system: string = LESSON_SYSTEM_PROMPT,
  ): Promise<WriterResult<T>> {
    const calls: Call<unknown>[] = [];
    for (const model of [this.config.model, this.config.fallbackModel]) {
      let response;
      try {
        // Streamed: long replies would otherwise hit the SDK's 10-minute limit for
        // non-streaming requests. finalMessage() waits for the whole reply and parses it.
        response = await this.client.messages
          .stream({
            model,
            max_tokens: maxTokens,
            // The system prompt never changes, so it's cached across all lessons.
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: userMessage }],
            output_config: { format: zodOutputFormat(schema), effort: this.config.effort },
          })
          .finalMessage();
      } catch (err) {
        throw classify(err, calls);
      }
      calls.push({ value: null, model: response.model ?? model, usage: usageOf(response.usage) });

      if (response.stop_reason === "refusal") continue; // try the fallback model
      if (response.stop_reason === "max_tokens") {
        throw new AiError(
          "too_long",
          "This lesson is too long to write in one go. Split it into smaller lessons in the outline editor, then try again.",
          `stop_reason max_tokens at ${maxTokens}`,
          calls,
        );
      }
      const parsed = (response as { parsed_output?: T | null }).parsed_output;
      if (!parsed) throw new AiError("retryable", "Claude's reply couldn't be read. We'll try again.", "parsed_output was null", calls);
      return { value: parsed, calls };
    }
    throw new AiError(
      "refused",
      "Claude declined to write this lesson. This sometimes happens with sensitive topics. You can edit the lesson by hand or try regenerating it.",
      "refusal on primary and fallback model",
      calls,
    );
  }

  writeLesson(input: LessonPromptInput) {
    return this.structured<LessonDraft>(LessonDraftSchema, lessonUserMessage(input), LESSON_MAX_TOKENS);
  }

  async writeQuestions(input: LessonPromptInput & { avoid: string[] }) {
    // Reuses the lesson schema's question format; only questions are requested.
    const res = await this.structured<{ questions: LessonDraft["questions"] }>(
      QuestionsDraftSchema,
      questionsUserMessage(input),
      QUESTIONS_MAX_TOKENS,
    );
    return res as WriterResult<QuestionsDraft>;
  }

  writeAssessment(input: AssessmentPromptInput) {
    return this.structured<AssessmentDraft>(AssessmentDraftSchema, assessmentUserMessage(input), 24_000, ASSESSMENT_SYSTEM_PROMPT);
  }

  async repairPage(png: Buffer): Promise<WriterResult<string>> {
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
                { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
                { type: "text", text: PAGE_REPAIR_PROMPT },
              ],
            },
          ],
        })
        .finalMessage();
    } catch (err) {
      throw classify(err, calls);
    }
    calls.push({ value: null, model: response.model ?? this.config.visionModel, usage: usageOf(response.usage) });
    if (response.stop_reason === "refusal") {
      throw new AiError("refused", "Claude declined to read this page.", "refusal", calls);
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { value: text, calls };
  }
}
