import { has, questionTypesOn, type CourseSettings } from "@/lib/course/settings";
import type { DraftQuestion, LessonContent, LessonDraft, StoredFlashcard, StoredQuestion } from "./lesson-schema";

/**
 * Checks and tidies what Claude returned before it's saved:
 * - page references outside the lesson's pages are removed (never trust a citation blindly)
 * - broken questions (e.g. a multiple-choice question whose answer index doesn't exist) are dropped
 * - content types the student turned off are removed, and counts are capped
 */

export type Range = { pageStart: number; pageEnd: number };

export function cleanPageRefs(refs: number[], r: Range): number[] {
  const ok = [...new Set(refs.filter((n) => Number.isInteger(n) && n >= r.pageStart && n <= r.pageEnd))].sort((a, b) => a - b);
  return ok.length > 0 ? ok.slice(0, 10) : [r.pageStart];
}

/** Remove "(p. N)" / "(pp. A–B)" citations in the explanation that point outside the lesson. */
export function cleanInlineCitations(text: string, r: Range): string {
  return text.replace(/\s?\((pp?)\.\s*(\d+)(?:\s*[–-]\s*(\d+))?\)/g, (match, _p, a: string, b?: string) => {
    const start = Number(a);
    const end = b ? Number(b) : start;
    const inside = start >= r.pageStart && end <= r.pageEnd && start <= end;
    return inside ? match : "";
  });
}

const tidy = (s: string) => s.replace(/\r\n/g, "\n").trim();
const nonEmpty = (s: string) => tidy(s).length > 0;

const TYPE_MAP = { multiple_choice: "MULTIPLE_CHOICE", short_answer: "SHORT_ANSWER", step_by_step: "STEP_BY_STEP" } as const;
const SETTING_FOR_TYPE = { multiple_choice: "multipleChoice", short_answer: "shortAnswer", step_by_step: "stepProblems" } as const;

export function normalizeQuestion(q: DraftQuestion, r: Range): StoredQuestion | null {
  const prompt = tidy(q.prompt);
  if (!prompt) return null;
  const base = {
    prompt,
    answer: tidy(q.answer),
    explanation: tidy(q.explanation),
    pageRefs: cleanPageRefs(q.pageRefs, r),
    topic: tidy(q.topic).slice(0, 100) || "General",
  };
  if (q.type === "multiple_choice") {
    const choices = q.choices.map(tidy);
    const unique = new Set(choices.map((c) => c.toLowerCase()));
    if (choices.length < 2 || choices.length > 6 || choices.some((c) => !c) || unique.size !== choices.length) return null;
    if (!Number.isInteger(q.correctChoice) || q.correctChoice < 0 || q.correctChoice >= choices.length) return null;
    return {
      ...base,
      type: "MULTIPLE_CHOICE",
      choices,
      correctChoice: q.correctChoice,
      answer: base.answer || choices[q.correctChoice],
      steps: [],
    };
  }
  if (!base.answer) return null;
  if (q.type === "step_by_step") {
    const steps = q.steps.map(tidy).filter(Boolean);
    if (steps.length === 0) return null;
    return { ...base, type: "STEP_BY_STEP", choices: [], correctChoice: null, steps };
  }
  return { ...base, type: TYPE_MAP[q.type], choices: [], correctChoice: null, steps: [] };
}

export function normalizeQuestions(questions: DraftQuestion[], r: Range, s: CourseSettings): StoredQuestion[] {
  const allowed = new Set(questionTypesOn(s));
  const seen = new Set<string>();
  const out: StoredQuestion[] = [];
  for (const q of questions) {
    if (!allowed.has(SETTING_FOR_TYPE[q.type])) continue;
    const n = normalizeQuestion(q, r);
    if (!n) continue;
    const key = n.prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= s.questionsPerLesson) break;
  }
  return out;
}

export type NormalizedLesson =
  | { usable: true; content: LessonContent; questions: StoredQuestion[]; flashcards: StoredFlashcard[]; dropped: number }
  | { usable: false; reason: string };

export function normalizeLessonDraft(draft: LessonDraft, r: Range, s: CourseSettings): NormalizedLesson {
  if (!draft.sourceCheck.usable) {
    return {
      usable: false,
      reason: tidy(draft.sourceCheck.problem) || "Claude reported that these pages don't have enough readable text to write a lesson from.",
    };
  }
  const explanation = cleanInlineCitations(tidy(draft.explanation), r);
  if (!explanation) return { usable: false, reason: "No explanation was produced for these pages." };

  const questions = normalizeQuestions(draft.questions, r, s);
  const flashcards: StoredFlashcard[] = has(s, "flashcards")
    ? draft.flashcards
        .filter((f) => nonEmpty(f.front) && nonEmpty(f.back))
        .slice(0, s.flashcardsPerLesson)
        .map((f) => ({ front: tidy(f.front), back: tidy(f.back), pageRefs: cleanPageRefs(f.pageRefs, r) }))
    : [];

  const content: LessonContent = {
    objectives: has(s, "objectives") ? draft.objectives.map(tidy).filter(Boolean).slice(0, 6) : [],
    explanation,
    workedExamples: has(s, "workedExamples")
      ? draft.workedExamples
          .filter((w) => nonEmpty(w.problem))
          .slice(0, 8)
          .map((w) => ({
            title: tidy(w.title) || "Example",
            problem: tidy(w.problem),
            steps: w.steps.map(tidy).filter(Boolean),
            answer: tidy(w.answer),
            pageRefs: cleanPageRefs(w.pageRefs, r),
          }))
      : [],
    keyTerms: has(s, "keyTerms")
      ? draft.keyTerms
          .filter((k) => nonEmpty(k.term) && nonEmpty(k.definition))
          .slice(0, 25)
          .map((k) => ({ term: tidy(k.term), definition: tidy(k.definition), pageRefs: cleanPageRefs(k.pageRefs, r) }))
      : [],
  };
  return { usable: true, content, questions, flashcards, dropped: draft.questions.length - questions.length };
}
