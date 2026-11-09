import { z } from "zod";
import { DraftQuestionSchema } from "./lesson-schema";
import { normalizeQuestion, type Range } from "./normalize";
import { questionTypesOn, LEVELS, type CourseSettings } from "@/lib/course/settings";
import type { LessonContent, StoredQuestion } from "./lesson-schema";

/**
 * Unit tests, unit summaries and the final exam (Phase 9).
 * They're written from the course's finished LESSONS (not the raw book
 * pages): cheaper, and the questions match what the student studied.
 */

export const ASSESSMENT_PROMPT_VERSION = "assessment-v1";

export const AssessmentDraftSchema = z.object({
  summary: z.string().describe("Unit tests only: a Markdown summary of the unit's key ideas (bullet points, (p. N) citations). Empty for the final exam."),
  questions: z.array(DraftQuestionSchema),
});
export type AssessmentDraft = z.infer<typeof AssessmentDraftSchema>;

export const ASSESSMENT_SYSTEM_PROMPT = `You write unit tests, unit summaries and final exams for Coursebook, an app that turns a textbook into a self-paced course.

You receive the lessons of one unit (or of the whole course, for a final exam) as they were taught to the student: objectives, explanation, worked examples and key terms, each lesson with its book pages.

<rules>
- Use only what's in these lessons. Every question must be answerable from them.
- Test understanding and application, not trivia: mix recall, explanation and problems, and include questions that connect ideas from different lessons.
- Don't copy the lessons' own practice questions; write new ones.
- Every question lists the book pages (from the lesson page ranges) where its answer is found.
- Write math in LaTeX: $...$ inline, $$...$$ displayed.
</rules>

<question_types>
- multiple_choice: exactly 4 choices, one correct (correctChoice is its 0-based index), believable wrong choices, no "all/none of the above"; vary the correct position.
- short_answer: answerable in 1–3 sentences; "answer" is a model answer; "explanation" says what a good answer must include.
- step_by_step: a problem to work through; "steps" is the full solution, one step per item; "answer" is the final result with units.
- Use an empty choices list and correctChoice -1 for non-multiple-choice questions, and an empty steps list for non-step-by-step questions.
- "topic" is a 2–5 word label for the idea tested.
</question_types>

<unit_summary>
For a unit test, also write "summary": the unit's key ideas as 5–10 Markdown bullet points a student could revise from, with (p. N) citations. For a final exam, leave it empty.
</unit_summary>`;

export type AssessmentLesson = { title: string; pageStart: number; pageEnd: number; content: LessonContent };

export type AssessmentPromptInput = {
  kind: "UNIT_TEST" | "FINAL_EXAM";
  courseTitle: string;
  unitTitle: string | null;
  lessons: AssessmentLesson[];
  questionCount: number;
  settings: CourseSettings;
  avoid: string[]; // existing practice question prompts
};

const TYPE_NAMES = { multipleChoice: "multiple_choice", shortAnswer: "short_answer", stepProblems: "step_by_step" } as const;
const MAX_LESSON_CHARS = 3_500;

export function questionCountFor(kind: "UNIT_TEST" | "FINAL_EXAM", lessons: number): number {
  return kind === "UNIT_TEST" ? Math.min(12, Math.max(5, lessons * 3)) : Math.min(30, Math.max(10, lessons * 2));
}

function lessonBlock(l: AssessmentLesson, perLesson: number): string {
  const c = l.content;
  const pages = l.pageStart === l.pageEnd ? `${l.pageStart}` : `${l.pageStart}-${l.pageEnd}`;
  const parts = [
    c.objectives.length ? `Objectives:\n${c.objectives.map((o) => `- ${o}`).join("\n")}` : "",
    `Explanation:\n${c.explanation.slice(0, perLesson)}${c.explanation.length > perLesson ? "\n[…]" : ""}`,
    c.workedExamples.length ? `Worked examples:\n${c.workedExamples.map((w) => `- ${w.title}: ${w.problem} → ${w.answer}`).join("\n")}` : "",
    c.keyTerms.length ? `Key terms:\n${c.keyTerms.map((k) => `- ${k.term}: ${k.definition}`).join("\n")}` : "",
  ].filter(Boolean);
  return `<lesson title="${l.title.replace(/"/g, "'")}" pages="${pages}">\n${parts.join("\n\n")}\n</lesson>`;
}

export function assessmentUserMessage(input: AssessmentPromptInput): string {
  // Long courses: shorten each lesson's explanation so the request stays a reasonable size.
  const perLesson = Math.max(800, Math.min(MAX_LESSON_CHARS, Math.floor(120_000 / Math.max(1, input.lessons.length))));
  const types = questionTypesOn(input.settings).map((t) => TYPE_NAMES[t]);
  const what =
    input.kind === "UNIT_TEST"
      ? `Write a unit summary and a ${input.questionCount}-question unit test for the unit "${input.unitTitle}" of "${input.courseTitle}".`
      : `Write a ${input.questionCount}-question final exam for the whole course "${input.courseTitle}", covering every unit in proportion to its size.`;
  return `${input.lessons.map((l) => lessonBlock(l, perLesson)).join("\n\n")}

${what}
Student level: ${LEVELS[input.settings.level]}.
Question types to use (mix them): ${types.length ? types.join(", ") : "multiple_choice"}.
${input.avoid.length ? `Don't repeat these practice questions:\n${input.avoid.slice(0, 60).map((a) => `- ${a.slice(0, 160)}`).join("\n")}` : ""}`.trim();
}

/** Tidy Claude's draft: valid questions only, allowed types, pages within the unit/course, capped count. */
export function normalizeAssessment(draft: AssessmentDraft, input: { kind: "UNIT_TEST" | "FINAL_EXAM"; range: Range; settings: CourseSettings; questionCount: number }) {
  const allowed = new Set(questionTypesOn(input.settings).map((t) => TYPE_NAMES[t]));
  const seen = new Set<string>();
  const questions: StoredQuestion[] = [];
  for (const q of draft.questions) {
    if (questions.length >= input.questionCount) break;
    if (allowed.size > 0 && !allowed.has(q.type)) continue;
    const n = normalizeQuestion(q, input.range);
    if (!n || seen.has(n.prompt.toLowerCase())) continue;
    seen.add(n.prompt.toLowerCase());
    questions.push(n);
  }
  const summary = input.kind === "UNIT_TEST" ? draft.summary.replace(/\r\n/g, "\n").trim().slice(0, 20_000) : "";
  return { summary, questions };
}
