import { ESSAY_CRITERIA, OFF_PROMPT_INSIGHT_CAP, PERSONAL_STATEMENT_WORD_LIMIT, PS_WEIGHT, SUPPLEMENT_WEIGHT, type EssayCriterion } from "./config";
import type { CriteriaScores } from "./inputs";

/** Essay rules that are applied in code, not left to the grader (spec 5.5). */

export const countWords = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each criterion's median across the grading runs, so a single odd run doesn't move the score. */
export function medianCriteria(runs: CriteriaScores[]): CriteriaScores {
  if (runs.length === 0) throw new Error("No grading runs");
  return Object.fromEntries(ESSAY_CRITERIA.map((c) => [c.key, median(runs.map((r) => r[c.key]))])) as CriteriaScores;
}

/** The run whose scores are closest to the medians: its quotes and suggestions are shown. */
export function closestRun<T extends { criteria: CriteriaScores }>(runs: T[], target: CriteriaScores): T {
  const dist = (r: T) => ESSAY_CRITERIA.reduce((d, c) => d + Math.abs(r.criteria[c.key] - target[c.key]), 0);
  return runs.reduce((best, r) => (dist(r) < dist(best) ? r : best));
}

export type EssayKind = "personal_statement" | "supplement";

/**
 * Word limit and prompt checks:
 * - over the word limit (650 for the personal statement, or the student's
 *   limit for a supplement): −1 on Clarity & mechanics, and a warning;
 * - a supplement that doesn't answer its prompt: Insight capped at 2, with why.
 */
export function applyEssayRules(
  criteria: CriteriaScores,
  opts: { kind: EssayKind; text: string; wordLimit: number | null; answersPrompt: boolean; promptNote?: string },
): { criteria: CriteriaScores; warnings: string[]; wordCount: number; limit: number | null } {
  const out = { ...criteria };
  const warnings: string[] = [];
  const wordCount = countWords(opts.text);
  const limit = opts.kind === "personal_statement" ? PERSONAL_STATEMENT_WORD_LIMIT : opts.wordLimit;
  if (limit && wordCount > limit) {
    out.clarity = Math.max(0, out.clarity - 1);
    warnings.push(`${wordCount} words is over the ${limit}-word limit, so Clarity & mechanics loses a point. Cut it to ${limit} or fewer.`);
  }
  if (opts.kind === "supplement" && !opts.answersPrompt) {
    if (out.insight > OFF_PROMPT_INSIGHT_CAP) out.insight = OFF_PROMPT_INSIGHT_CAP;
    warnings.push(`This essay doesn't fully answer its prompt, so Insight & reflection is capped at ${OFF_PROMPT_INSIGHT_CAP}.${opts.promptNote ? ` ${opts.promptNote}` : ""}`);
  }
  return { criteria: out, warnings, wordCount, limit };
}

/** One essay's score out of 25. */
export const essayTotal = (c: CriteriaScores) => ESSAY_CRITERIA.reduce((s, k) => s + c[k.key], 0);

/** Personal statement only: its score. With supplements: 0.7 × PS + 0.3 × their average. */
export function combineEssays(ps: number, supplements: number[]): number {
  if (supplements.length === 0) return ps;
  return PS_WEIGHT * ps + SUPPLEMENT_WEIGHT * (supplements.reduce((a, b) => a + b, 0) / supplements.length);
}

export const criterionLabel = (k: EssayCriterion) => ESSAY_CRITERIA.find((c) => c.key === k)!.label;
