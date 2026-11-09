/**
 * Which Claude model does which job, and what each costs.
 * Prices are US dollars per million tokens (checked November 2026).
 * Models can be changed with environment variables later (Phase 4).
 */

export const MODEL_PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
} as const;
export type ModelId = keyof typeof MODEL_PRICES;

export const DEFAULT_MODELS = {
  generation: "claude-sonnet-5-5", // lessons, questions, flashcards, summaries, tests
  grading: "claude-opus-5-5", // checking short answers
  tutor: "claude-opus-5-5", // "Ask the book"
  vision: "claude-sonnet-5-5", // re-reading equation-heavy pages from images
} as const satisfies Record<string, ModelId>;

export function costUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
