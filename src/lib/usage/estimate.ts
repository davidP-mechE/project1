import { costUsd, DEFAULT_MODELS, type ModelId } from "@/lib/ai/models";
import { has, questionTypesOn, type CourseSettings } from "@/lib/course/settings";

/**
 * Estimates what generating a course will cost and how long it will take,
 * BEFORE anything is sent to Claude. The numbers are rough averages; Phase 4
 * records real token usage so they can be checked and tuned.
 */

export type EstimateLesson = { unitKey: string; pages: number; chars: number; mathHeavyPages: number };

// Rough token budgets (1 token ≈ 4 characters of English).
export const TOKENS = {
  lessonPrompt: 2_000, // instructions + settings, sent with every lesson (mostly cached)
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

export type Estimate = {
  lessons: number;
  units: number;
  pages: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  minutes: number;
};

export function estimateGeneration(lessons: EstimateLesson[], settings: CourseSettings, model: ModelId = DEFAULT_MODELS.generation): Estimate {
  const unitKeys = [...new Set(lessons.map((l) => l.unitKey))];
  const qTypes = questionTypesOn(settings).length;
  const questions = qTypes > 0 ? settings.questionsPerLesson : 0;
  const flashcards = has(settings, "flashcards") ? settings.flashcardsPerLesson : 0;

  // A one-page lesson gets a shorter explanation than a 15-page one.
  const explanationFor = (chars: number) => Math.min(TOKENS.explanation[settings.style], 600 + Math.ceil(chars / 4));
  const extrasOut =
    (has(settings, "objectives") ? TOKENS.objectives : 0) +
    (has(settings, "keyTerms") ? TOKENS.keyTerms : 0) +
    (has(settings, "workedExamples") ? TOKENS.workedExamples : 0) +
    questions * TOKENS.perQuestion +
    flashcards * TOKENS.perFlashcard;

  let input = 0;
  let output = 0;
  let pages = 0;
  for (const l of lessons) {
    input += TOKENS.lessonPrompt + Math.ceil(l.chars / 4);
    output += (explanationFor(l.chars) + extrasOut) * (1 + TOKENS.thinkingOverhead);
    pages += l.pages;
    input += l.mathHeavyPages * TOKENS.visionPageIn;
    output += l.mathHeavyPages * TOKENS.visionPageOut;
  }

  for (const unit of unitKeys) {
    const count = lessons.filter((l) => l.unitKey === unit).length;
    if (has(settings, "unitSummaries")) {
      input += TOKENS.lessonPrompt + count * TOKENS.perLessonDigest;
      output += TOKENS.unitSummaryOut * (1 + TOKENS.thinkingOverhead);
    }
    if (has(settings, "unitTests")) {
      input += TOKENS.lessonPrompt + count * TOKENS.perLessonDigest;
      output += TOKENS.unitTestQuestions * TOKENS.perQuestion * (1 + TOKENS.thinkingOverhead);
    }
  }
  if (has(settings, "finalExam") && lessons.length > 0) {
    input += TOKENS.lessonPrompt + lessons.length * (TOKENS.perLessonDigest / 3);
    output += TOKENS.finalExamQuestions * TOKENS.perQuestion * (1 + TOKENS.thinkingOverhead);
  }

  input = Math.round(input);
  output = Math.round(output);
  return {
    lessons: lessons.length,
    units: unitKeys.length,
    pages,
    inputTokens: input,
    outputTokens: output,
    costUsd: Math.round(costUsd(model, input, output) * 100) / 100,
    minutes: Math.max(1, Math.ceil((lessons.length * SECONDS_PER_LESSON) / PARALLEL_LESSONS / 60)),
  };
}
