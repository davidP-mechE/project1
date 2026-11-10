/**
 * Which Claude model does which job, and what each costs.
 * Prices are US dollars per million tokens (checked November 2026).
 * cacheWrite = writing the prompt cache (5-minute, 1.25x input), cacheRead = reusing it.
 * Requests sent through the Message Batches API cost half of all of these.
 */

export const MODEL_PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
} as const;
export type ModelId = keyof typeof MODEL_PRICES;

/** Batch requests are billed at 50% of the standard price, input and output alike. */
export const BATCH_DISCOUNT = 0.5;

export const DEFAULT_MODELS = {
  generation: "claude-sonnet-5-5", // lessons, practice questions, unit tests
  flashcards: "claude-haiku-5-5", // short term/answer cards: a simple job
  fallback: "claude-opus-5-5", // used if a model declines a request
  grading: "claude-opus-5-5", // checking short answers
  tutor: "claude-opus-5-5", // "Ask the book"
  vision: "claude-haiku-5-5", // transcribing equation-heavy pages and picture slides
} as const satisfies Record<string, ModelId>;

export const isKnownModel = (m: string): m is ModelId => m in MODEL_PRICES;

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };

/** Cost in US dollars. Unknown models are priced like Opus so costs are never under-counted. */
export function costUsd(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0, batch = false): number {
  const p = isKnownModel(model) ? MODEL_PRICES[model] : MODEL_PRICES["claude-opus-5-5"];
  const full = (inputTokens * p.input + outputTokens * p.output + cacheReadTokens * p.cacheRead + cacheWriteTokens * p.cacheWrite) / 1_000_000;
  return batch ? full * BATCH_DISCOUNT : full;
}
