import Anthropic from "@anthropic-ai/sdk";
import { TUTOR_SYSTEM_PROMPT, type TutorTurn } from "@/lib/tutor/prompt";
import { SAT_CURRICULUM } from "@/lib/tutor/sat-curriculum";
import { NOT_IN_BOOK } from "@/lib/tutor/citations";
import { AiError, type Call } from "./writer";
import { usageCalls } from "./grader";

/** Streams a tutor answer. Tests use a fake one. */
export interface TutorModel {
  readonly kind: "claude" | "demo";
  answer(messages: TutorTurn[], onText: (text: string) => void, signal: AbortSignal, opts?: TutorOptions): Promise<TutorAnswer>;
}
/** sat: the course is SAT prep, so the tutor also gets the program's SAT curriculum. */
export type TutorOptions = { sat?: boolean };
export type TutorAnswer = { text: string; calls: Call<unknown>[]; stop: "done" | "stopped" | "too_long" };

export type TutorConfig = { model: string; effort: "low" | "medium" | "high" | "xhigh" | "max" };

const TUTOR_MAX_TOKENS = 16_000; // includes thinking; answers themselves are short

export class ClaudeTutor implements TutorModel {
  readonly kind = "claude" as const;
  constructor(
    private readonly client: Anthropic,
    private readonly config: TutorConfig,
  ) {}

  async answer(messages: TutorTurn[], onText: (text: string) => void, signal: AbortSignal, opts: TutorOptions = {}): Promise<TutorAnswer> {
    let text = "";
    // Usage as it arrives, so a stopped answer is still billed correctly.
    let partial: { input: number; output: number; cacheRead: number; cacheWrite: number; model: string } | null = null;
    const stream = this.client.beta.messages.stream(
      {
        model: this.config.model,
        max_tokens: TUTOR_MAX_TOKENS,
        // Both blocks are fixed text, so each is cached; SAT courses add the curriculum after the rules.
        system: [
          { type: "text", text: TUTOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          ...(opts.sat ? [{ type: "text" as const, text: SAT_CURRICULUM, cache_control: { type: "ephemeral" as const } }] : []),
        ],
        messages,
        output_config: { effort: this.config.effort },
        // If the safety filter misreads a textbook topic, the API retries on a suitable model itself.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    try {
      for await (const ev of stream) {
        if (ev.type === "message_start") {
          const u = ev.message.usage;
          partial = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, model: ev.message.model ?? this.config.model };
        } else if (ev.type === "message_delta" && partial) {
          partial.output = ev.usage.output_tokens;
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          text += ev.delta.text;
          onText(ev.delta.text);
        }
      }
      const final = await stream.finalMessage();
      const calls = usageCalls(final, this.config.model);
      if (final.stop_reason === "refusal") {
        throw new AiError("refused", "Claude declined to answer this question. Try asking it a different way.", "refusal", calls);
      }
      return { text, calls, stop: final.stop_reason === "max_tokens" ? "too_long" : "done" };
    } catch (err) {
      const calls: Call<unknown>[] = partial
        ? [{ value: null, model: partial.model, usage: { inputTokens: partial.input, outputTokens: partial.output, cacheReadTokens: partial.cacheRead, cacheWriteTokens: partial.cacheWrite } }]
        : [];
      if (signal.aborted || err instanceof Anthropic.APIUserAbortError) return { text, calls, stop: "stopped" };
      if (err instanceof AiError) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiError("config", "The tutor isn't set up correctly on the server (the Claude API key was rejected).", err.message, calls);
      }
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new AiError("retryable", "Claude is busy right now. Please ask again in a minute.", err.message, calls);
      }
      throw new AiError("invalid", "The tutor couldn't answer that. Please try again.", err instanceof Error ? err.message : String(err), calls);
    }
  }
}

/**
 * Demo mode (FAKE_CLAUDE=true): quotes the best passage instead of calling
 * Claude, streamed word by word so the chat UI behaves like the real thing.
 */
export class DemoTutor implements TutorModel {
  readonly kind = "demo" as const;
  async answer(messages: TutorTurn[], onText: (text: string) => void, signal: AbortSignal): Promise<TutorAnswer> {
    const last = messages[messages.length - 1]?.content ?? "";
    const question = /<question>\n([\s\S]*?)\n<\/question>/.exec(last)?.[1] ?? "";
    const words = new Set(question.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    // Quote the passage sharing the most words with the question.
    const passages = [...last.matchAll(/<passage pages="(\d+)(?:-(\d+))?">\n([\s\S]*?)\n<\/passage>/g)];
    const score = (t: string) => (t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length;
    const m = passages.sort((a, b) => score(b[3]) - score(a[3]))[0];
    const reply = m
      ? `**Demo answer** (not written by Claude, FAKE_CLAUDE=true). The most relevant passage says:\n\n> ${m[3].slice(0, 400).replace(/\n+/g, " ")}… [p. ${m[1]}]`
      : `${NOT_IN_BOOK} (Demo answer: no passage in the book matched your question.)`;
    let text = "";
    for (const word of reply.split(/(?<= )/)) {
      if (signal.aborted) return { text, calls: [], stop: "stopped" };
      text += word;
      onText(word);
      await new Promise((r) => setTimeout(r, 8));
    }
    return { text, calls: [], stop: "done" };
  }
}
