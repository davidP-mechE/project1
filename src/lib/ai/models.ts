/**
 * Which Claude model does which job, and what each costs.
 * Prices are US dollars per million tokens (checked November 2026).
 * cacheWrite = writing the prompt cache (5-minute), cacheRead = reusing it.
 */

export const MODEL_PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
} as const;
export type ModelId = keyof typeof MODEL_PRICES;

export const DEFAULT_MODELS = {
  generation: "claude-sonnet-5-5", // lessons, questions, flashcards
  fallback: "claude-opus-5-5", // used if the generation model declines a request
  grading: "claude-opus-5-5", // checking short answers (Phase 5)
  tutor: "claude-opus-5-5", // "Ask the book" (Phase 7)
  vision: "claude-sonnet-5-5", // re-reading equation-heavy pages from images
} as const satisfies Record<string, ModelId>;

export const isKnownModel = (m: string): m is ModelId => m in MODEL_PRICES;

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };

/** Cost in US dollars. Unknown models are priced like Opus so costs are never under-counted. */
export function costUsd(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0): number {
  const p = isKnownModel(model) ? MODEL_PRICES[model] : MODEL_PRICES["claude-opus-5-5"];
  return (inputTokens * p.input + outputTokens * p.output + cacheReadTokens * p.cacheRead + cacheWriteTokens * p.cacheWrite) / 1_000_000;
}
