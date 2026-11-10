import { costUsd, DEFAULT_MODELS, type ModelId } from "@/lib/ai/models";
import {
  has,
  questionTypesOn,
  type CourseSettings,
} from "@/lib/course/settings";

/**
 * Estimates what generating a course will cost and how long it will take,
 * BEFORE anything is sent to Claude, step by step (lessons, flashcards,
 * page reading, unit summaries and tests, final exam). The numbers are rough
 * averages; real token usage is recorded per step (see `npm run cost:breakdown`).
 */

export type EstimateLesson = {
  unitKey: string;
  pages: number;
  chars: number;
  mathHeavyPages: number;
};

// Rough token budgets (1 token ≈ 4 characters of English).
export const TOKENS = {
  lessonPrompt: 2_000, // instructions + settings, sent with every lesson (mostly cached)
  flashcardPrompt: 600, // the flashcard instructions (the pages are counted separately)
  explanation: { concise: 1_800, detailed: 3_600 },
  objectives: 150,
  keyTerms: 400,
  workedExamples: 700,
  perQuestion: 260,
  perFlashcard: 60,
  thinkingOverhead: 0.3, // extra output for the model's reasoning
  unitSummaryOut: 900,
  unitTestQuestions: 12,
  finalExamQuestions: 30,
  perLessonDigest: 900, // what a unit/exam prompt reads about each lesson
  visionPageIn: 1_700, // one page image
  visionPageOut: 700,
};

export const SECONDS_PER_LESSON = 40;
export const PARALLEL_LESSONS = 3;

/** Which model does each step, and whether course generation goes through the Batch API (half price). */
export type GenerationPlan = {
  lessonModel: ModelId;
  flashcardModel: ModelId;
  visionModel: ModelId;
  /** Lessons, flashcards and automatic unit tests/final exam are sent as a batch. Page reading is not. */
  batch: boolean;
  /** Flashcards get their own (cheap) request instead of being written with the lesson. */
  separateFlashcards: boolean;
};

export const DEFAULT_PLAN: GenerationPlan = {
  lessonModel: DEFAULT_MODELS.generation,
  flashcardModel: DEFAULT_MODELS.flashcards,
  visionModel: DEFAULT_MODELS.vision,
  batch: true,
  separateFlashcards: true,
};

/** How courses were generated before batching and Haiku: everything on the lesson model, one request at a time. */
export const LEGACY_PLAN: GenerationPlan = {
  lessonModel: "claude-sonnet-5-5",
  flashcardModel: "claude-sonnet-5-5",
  visionModel: "claude-sonnet-5-5",
  batch: false,
  separateFlashcards: false,
};

export type StepId =
  | "lessons"
  | "flashcards"
  | "pageReading"
  | "unitSummaries"
  | "unitTests"
  | "finalExam";
export const STEP_LABELS: Record<StepId, string> = {
  lessons: "Lessons + practice questions",
  flashcards: "Flashcards",
  pageReading: "Reading equation-heavy pages",
  unitSummaries: "Unit summaries",
  unitTests: "Unit tests",
  finalExam: "Final exam",
};

export type StepEstimate = {
  step: StepId;
  model: ModelId;
  batch: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type Estimate = {
  lessons: number;
  units: number;
  pages: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  minutes: number;
  /** Sent as a half-price batch: lessons arrive together, usually within an hour (at most a day). */
  batch: boolean;
  steps: StepEstimate[];
};

export function estimateGeneration(
  lessons: EstimateLesson[],
  settings: CourseSettings,
  plan: GenerationPlan = DEFAULT_PLAN,
): Estimate {
  const unitKeys = [...new Set(lessons.map((l) => l.unitKey))];
  const qTypes = questionTypesOn(settings).length;
  const questions = qTypes > 0 ? settings.questionsPerLesson : 0;
  const flashcards = has(settings, "flashcards")
    ? settings.flashcardsPerLesson
    : 0;
  const thinking = 1 + TOKENS.thinkingOverhead;

  // A one-page lesson gets a shorter explanation than a 15-page one.
  const explanationFor = (chars: number) =>
    Math.min(TOKENS.explanation[settings.style], 600 + Math.ceil(chars / 4));
  const lessonExtrasOut =
    (has(settings, "objectives") ? TOKENS.objectives : 0) +
    (has(settings, "keyTerms") ? TOKENS.keyTerms : 0) +
    (has(settings, "workedExamples") ? TOKENS.workedExamples : 0) +
    questions * TOKENS.perQuestion;

  const tally: Record<StepId, { input: number; output: number }> = {
    lessons: { input: 0, output: 0 },
    flashcards: { input: 0, output: 0 },
    pageReading: { input: 0, output: 0 },
    unitSummaries: { input: 0, output: 0 },
    unitTests: { input: 0, output: 0 },
    finalExam: { input: 0, output: 0 },
  };
  let pages = 0;
  for (const l of lessons) {
    const pageTokens = Math.ceil(l.chars / 4);
    tally.lessons.input += TOKENS.lessonPrompt + pageTokens;
    tally.lessons.output +=
      (explanationFor(l.chars) + lessonExtrasOut) * thinking;
    if (flashcards > 0) {
      // Its own request reads the pages again, plus short instructions; otherwise they come out of the lesson request.
      if (plan.separateFlashcards)
        tally.flashcards.input += TOKENS.flashcardPrompt + pageTokens;
      tally.flashcards.output += flashcards * TOKENS.perFlashcard * thinking;
    }
    tally.pageReading.input += l.mathHeavyPages * TOKENS.visionPageIn;
    tally.pageReading.output += l.mathHeavyPages * TOKENS.visionPageOut;
    pages += l.pages;
  }
  for (const unit of unitKeys) {
    const count = lessons.filter((l) => l.unitKey === unit).length;
    if (has(settings, "unitSummaries")) {
      tally.unitSummaries.input +=
        TOKENS.lessonPrompt + count * TOKENS.perLessonDigest;
      tally.unitSummaries.output += TOKENS.unitSummaryOut * thinking;
    }
    if (has(settings, "unitTests")) {
      tally.unitTests.input +=
        TOKENS.lessonPrompt + count * TOKENS.perLessonDigest;
      tally.unitTests.output +=
        TOKENS.unitTestQuestions * TOKENS.perQuestion * thinking;
    }
  }
  if (has(settings, "finalExam") && lessons.length > 0) {
    tally.finalExam.input +=
      TOKENS.lessonPrompt + lessons.length * (TOKENS.perLessonDigest / 3);
    tally.finalExam.output +=
      TOKENS.finalExamQuestions * TOKENS.perQuestion * thinking;
  }

  const modelFor: Record<StepId, ModelId> = {
    lessons: plan.lessonModel,
    flashcards: plan.separateFlashcards
      ? plan.flashcardModel
      : plan.lessonModel,
    pageReading: plan.visionModel,
    unitSummaries: plan.lessonModel,
    unitTests: plan.lessonModel,
    finalExam: plan.lessonModel,
  };
  const steps: StepEstimate[] = (Object.keys(tally) as StepId[])
    .filter((step) => tally[step].input + tally[step].output > 0)
    .map((step) => {
      const batch = plan.batch && step !== "pageReading"; // pages are read before the batch is sent
      const inputTokens = Math.round(tally[step].input);
      const outputTokens = Math.round(tally[step].output);
      return {
        step,
        model: modelFor[step],
        batch,
        inputTokens,
        outputTokens,
        costUsd: costUsd(
          modelFor[step],
          inputTokens,
          outputTokens,
          0,
          0,
          batch,
        ),
      };
    });

  const input = steps.reduce((n, s) => n + s.inputTokens, 0);
  const output = steps.reduce((n, s) => n + s.outputTokens, 0);
  const total = steps.reduce((n, s) => n + s.costUsd, 0);
  return {
    lessons: lessons.length,
    units: unitKeys.length,
    pages,
    inputTokens: input,
    outputTokens: output,
    costUsd: Math.round(total * 100) / 100,
    minutes: Math.max(
      1,
      Math.ceil((lessons.length * SECONDS_PER_LESSON) / PARALLEL_LESSONS / 60),
    ),
    batch: plan.batch,
    steps,
  };
}
