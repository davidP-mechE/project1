import { z } from "zod";

/**
 * The shapes of generated lesson content.
 *
 * `LessonDraftSchema` is what Claude must return (enforced with "structured
 * outputs", so the reply always parses). It deliberately has no min/max
 * rules: the API doesn't support those, so we check and tidy the draft
 * ourselves afterwards (normalize.ts).
 */

const pageRefs = z.array(z.number().int()).describe("Page numbers (from the page markers) where this content appears.");

export const QUESTION_TYPES = ["multiple_choice", "short_answer", "step_by_step"] as const;

export const DraftQuestionSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  prompt: z.string(),
  choices: z.array(z.string()).describe("Multiple choice only: 4 options. Empty for other types."),
  correctChoice: z.number().int().describe("Multiple choice only: 0-based index of the correct option. -1 for other types."),
  answer: z.string().describe("The correct answer (model answer for short answer; final result for step-by-step)."),
  explanation: z.string().describe("Why this is the answer, for a student who got it wrong."),
  steps: z.array(z.string()).describe("Step-by-step only: the full worked solution, one step per item. Empty for other types."),
  pageRefs,
  topic: z.string().describe("2-5 word label of the idea tested."),
});

export const LessonDraftSchema = z.object({
  sourceCheck: z.object({
    usable: z.boolean().describe("false if the pages don't contain enough readable text to teach this lesson."),
    problem: z.string().describe("If not usable: a short explanation of what's wrong with the pages. Otherwise empty."),
  }),
  objectives: z.array(z.string()),
  explanation: z.string().describe("The lesson explanation in Markdown, with LaTeX math and (p. N) citations."),
  workedExamples: z.array(
    z.object({
      title: z.string(),
      problem: z.string(),
      steps: z.array(z.string()),
      answer: z.string(),
      pageRefs,
    }),
  ),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string(), pageRefs })),
  questions: z.array(DraftQuestionSchema),
  flashcards: z.array(z.object({ front: z.string(), back: z.string(), pageRefs })),
});
export type LessonDraft = z.infer<typeof LessonDraftSchema>;
export type DraftQuestion = z.infer<typeof DraftQuestionSchema>;

export const QuestionsDraftSchema = z.object({ questions: z.array(DraftQuestionSchema) });
export type QuestionsDraft = z.infer<typeof QuestionsDraftSchema>;

// ─── What we store on the Lesson row (questions and flashcards have their own tables) ──

export const WorkedExampleSchema = z.object({
  title: z.string().max(300),
  problem: z.string().max(5_000),
  steps: z.array(z.string().max(3_000)).max(40),
  answer: z.string().max(2_000),
  pageRefs: z.array(z.number().int()).max(20),
});
export const KeyTermSchema = z.object({
  term: z.string().min(1).max(200),
  definition: z.string().min(1).max(2_000),
  pageRefs: z.array(z.number().int()).max(20),
});
export const LessonContentSchema = z.object({
  objectives: z.array(z.string().min(1).max(500)).max(10),
  explanation: z.string().min(1).max(60_000),
  workedExamples: z.array(WorkedExampleSchema).max(10),
  keyTerms: z.array(KeyTermSchema).max(40),
});
export type LessonContent = z.infer<typeof LessonContentSchema>;

export const StoredQuestionSchema = z
  .object({
    type: z.enum(["MULTIPLE_CHOICE", "SHORT_ANSWER", "STEP_BY_STEP"]),
    prompt: z.string().min(1).max(3_000),
    choices: z.array(z.string().min(1).max(1_000)).max(6),
    correctChoice: z.number().int().nullable(),
    answer: z.string().max(3_000),
    explanation: z.string().max(5_000),
    steps: z.array(z.string().min(1).max(3_000)).max(40),
    pageRefs: z.array(z.number().int()).max(20),
    topic: z.string().max(100),
  })
  .superRefine((q, ctx) => {
    if (q.type === "MULTIPLE_CHOICE") {
      if (q.choices.length < 2) ctx.addIssue({ code: "custom", message: "A multiple-choice question needs at least 2 choices." });
      if (q.correctChoice === null || q.correctChoice < 0 || q.correctChoice >= q.choices.length) {
        ctx.addIssue({ code: "custom", message: "Pick which choice is correct." });
      }
    } else if (!q.answer.trim()) {
      ctx.addIssue({ code: "custom", message: "Add the correct answer." });
    }
  });
export type StoredQuestion = z.infer<typeof StoredQuestionSchema>;

export const StoredFlashcardSchema = z.object({
  // Present when editing an existing card, so its review history is kept.
  id: z.string().max(64).optional(),
  front: z.string().min(1).max(1_000),
  back: z.string().min(1).max(2_000),
  pageRefs: z.array(z.number().int()).max(20),
});
export type StoredFlashcard = z.infer<typeof StoredFlashcardSchema>;

/** What the lesson editor sends when a student hand-edits a lesson. */
export const LessonEditSchema = z.object({
  content: LessonContentSchema,
  questions: z.array(StoredQuestionSchema).max(50),
  flashcards: z.array(StoredFlashcardSchema).max(100),
});
export type LessonEdit = z.infer<typeof LessonEditSchema>;
