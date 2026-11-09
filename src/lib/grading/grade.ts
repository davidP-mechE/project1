import { z } from "zod";

/**
 * Grading results, whoever graded them (multiple choice locally, written
 * answers by Claude). Pure functions, unit-tested.
 */

export type Verdict = "CORRECT" | "PARTIAL" | "INCORRECT";
export type GradeResult = { verdict: Verdict; correct: boolean; score: number; feedback: string };

/** Score at or above which a written answer counts as correct for progress and weak topics. */
export const PASS_SCORE = 0.8;

export function gradeMultipleChoice(q: { choices: string[]; correctChoice: number | null; explanation: string }, choice: unknown): GradeResult | { error: string } {
  if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) {
    return { error: "Pick one of the answers first." };
  }
  if (q.correctChoice === null || q.correctChoice < 0 || q.correctChoice >= q.choices.length) {
    return { error: "This question has no correct answer set. Edit the lesson to fix it." };
  }
  const correct = choice === q.correctChoice;
  return {
    verdict: correct ? "CORRECT" : "INCORRECT",
    correct,
    score: correct ? 1 : 0,
    feedback: correct ? "Correct!" : `Not quite. The answer is ${String.fromCharCode(65 + q.correctChoice)}.`,
  };
}

/** What Claude returns when grading (structured output, so it always parses). */
export const GradeDraftSchema = z.object({
  verdict: z.enum(["correct", "partially_correct", "incorrect"]).describe("Overall judgement against the model answer and the book."),
  score: z.number().describe("0 to 1: how much of a complete answer this is."),
  feedback: z
    .string()
    .describe("1-3 sentences to the student: what they got right, and what is missing or wrong. Cite pages like (p. 12) when useful."),
});
export type GradeDraft = z.infer<typeof GradeDraftSchema>;

const VERDICTS = { correct: "CORRECT", partially_correct: "PARTIAL", incorrect: "INCORRECT" } as const;

/**
 * Make Claude's grade consistent before saving: the score is clamped to 0-1
 * and kept in line with the verdict (a "correct" answer never scores 0.2),
 * and feedback is trimmed to a sane length.
 */
export function normalizeGrade(draft: GradeDraft): GradeResult {
  const verdict: Verdict = VERDICTS[draft.verdict] ?? "INCORRECT";
  let score = Number.isFinite(draft.score) ? draft.score : 0;
  if (score > 1 && score <= 100) score = score / 100; // "80" meant 80%
  score = Math.min(1, Math.max(0, score));
  if (verdict === "CORRECT") score = Math.max(score, PASS_SCORE);
  if (verdict === "PARTIAL") score = Math.min(Math.max(score, 0.2), PASS_SCORE - 0.05);
  if (verdict === "INCORRECT") score = Math.min(score, 0.3);
  const feedback = draft.feedback.trim().slice(0, 1_500) || (verdict === "CORRECT" ? "Correct!" : "Compare your answer with the model answer below.");
  return { verdict, correct: verdict === "CORRECT", score: Math.round(score * 100) / 100, feedback };
}

/** Practice score for a lesson: each question's latest attempt counts. */
export function practiceSummary(questionIds: string[], latest: Map<string, { correct: boolean }>) {
  const answered = questionIds.filter((id) => latest.has(id));
  return { total: questionIds.length, answered: answered.length, correct: answered.filter((id) => latest.get(id)!.correct).length };
}
