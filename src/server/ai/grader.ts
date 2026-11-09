import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GradeDraftSchema, type GradeDraft } from "@/lib/grading/grade";
import { GRADING_SYSTEM_PROMPT, gradingUserMessage, type GradingInput } from "@/lib/ai/grading-prompt";
import { normalizeAnswer } from "@/lib/grading/normalize";
import type { TokenUsage } from "@/lib/ai/models";
import { AiError, type Call, type WriterResult } from "./writer";

/**
 * Grades a student's written answer. Like the lesson writer, tests use a fake
 * one, so the test suite never calls the API.
 */
export interface Grader {
  /** "claude" or "demo", saved with each attempt so the UI can say who graded it. */
  readonly kind: "claude" | "demo";
  grade(input: GradingInput): Promise<WriterResult<GradeDraft>>;
}

export type GraderConfig = { model: string; effort: "low" | "medium" | "high" | "xhigh" | "max" };

// Thinking is always on for current Opus models; this leaves room for it plus a short reply.
const GRADE_MAX_TOKENS = 8_000;
const GRADE_TIMEOUT_MS = 90_000;

function usageCalls(response: Anthropic.Beta.BetaMessage, requested: string): Call<unknown>[] {
  const toUsage = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): TokenUsage => ({
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  });
  // If the model declined and a fallback model answered, each is billed at its own price.
  const its = (response.usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  if (its.some((i) => i.type === "fallback_message")) {
    return its.map((i) => ({ value: null, model: ("model" in i && i.model) || requested, usage: toUsage(i) }));
  }
  return [{ value: null, model: response.model ?? requested, usage: toUsage(response.usage) }];
}

function classify(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("config", "Answer checking isn't set up correctly on the server (the Claude API key was rejected).", err.message);
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new AiError("retryable", "Claude is busy right now, so your answer couldn't be checked. Please try again in a minute.", err.message);
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError("invalid", "Your answer couldn't be checked. Please try again.", `${err.status}: ${err.message}`);
  }
  return new AiError("retryable", "Your answer couldn't be checked. Please try again.", String(err));
}

export class ClaudeGrader implements Grader {
  readonly kind = "claude" as const;
  constructor(
    private readonly client: Anthropic,
    private readonly config: GraderConfig,
  ) {}

  async grade(input: GradingInput): Promise<WriterResult<GradeDraft>> {
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.config.model,
          max_tokens: GRADE_MAX_TOKENS,
          // Never changes, so it's cached across every grading request.
          system: [{ type: "text", text: GRADING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: gradingUserMessage(input) }],
          output_config: { format: betaZodOutputFormat(GradeDraftSchema), effort: this.config.effort },
          // If the safety filter misreads a textbook topic, the API retries on a suitable model itself.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: GRADE_TIMEOUT_MS },
      );
    } catch (err) {
      throw classify(err);
    }
    const calls = usageCalls(response, this.config.model);
    if (response.stop_reason === "refusal") {
      throw new AiError("refused", "Claude declined to check this answer. Compare it with the model answer below.", "refusal", calls);
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new AiError("retryable", "Your answer couldn't be checked. Please try again.", `stop_reason ${response.stop_reason}`, calls);
    }
    return { value: response.parsed_output, calls };
  }
}

/**
 * Demo mode (FAKE_CLAUDE=true): a rough word-overlap check, free and offline.
 * The UI labels these results "Demo check" so nobody mistakes them for real grading.
 */
export class DemoGrader implements Grader {
  readonly kind = "demo" as const;
  async grade(input: GradingInput): Promise<WriterResult<GradeDraft>> {
    const words = (s: string) => new Set(normalizeAnswer(s).split(" ").filter((w) => w.length > 3));
    const ref = words(input.answer);
    const res = words(input.response);
    const overlap = ref.size === 0 ? 0 : [...ref].filter((w) => res.has(w)).length / ref.size;
    const verdict = overlap >= 0.6 ? "correct" : overlap >= 0.25 ? "partially_correct" : "incorrect";
    return {
      value: {
        verdict,
        score: overlap,
        feedback: `Your answer shares ${Math.round(overlap * 100)}% of the key words in the model answer.`,
      },
      calls: [],
    };
  }
}
