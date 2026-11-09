import type { LessonDraft } from "@/lib/ai/lesson-schema";

/** A believable lesson draft for pages [start, end], for tests. */
export function sampleDraft(start: number, end: number, overrides: Partial<LessonDraft> = {}): LessonDraft {
  return {
    sourceCheck: { usable: true, problem: "" },
    objectives: ["Explain what electric charge is.", "Calculate current from charge and time."],
    explanation: `### Charge\n\nCharge is a property of matter (p. ${start}). Current is the rate of flow of charge, $I = Q/t$ (p. ${end}).\n\nThis cites a page outside the lesson (p. 999).`,
    workedExamples: [
      { title: "Finding current", problem: "2 C passes in 4 s. Find I.", steps: ["$I = Q/t$", "$I = 2/4 = 0.5$ A"], answer: "0.5 A", pageRefs: [end, 999] },
    ],
    keyTerms: [{ term: "Current", definition: "The rate of flow of charge.", pageRefs: [end] }],
    questions: [
      { type: "multiple_choice", prompt: "What is the unit of current?", choices: ["Volt", "Ampere", "Ohm", "Watt"], correctChoice: 1, answer: "", explanation: "Current is measured in amperes.", steps: [], pageRefs: [end], topic: "Units" },
      { type: "short_answer", prompt: "What is current?", choices: [], correctChoice: -1, answer: "The rate of flow of charge.", explanation: "Defined on the page.", steps: [], pageRefs: [start], topic: "Current" },
      { type: "step_by_step", prompt: "6 C flows in 3 s. Find the current.", choices: [], correctChoice: -1, answer: "2 A", explanation: "Use I = Q/t.", steps: ["I = Q/t", "I = 6/3 = 2 A"], pageRefs: [end], topic: "Current calculation" },
      { type: "multiple_choice", prompt: "Broken question", choices: ["A", "B"], correctChoice: 5, answer: "", explanation: "", steps: [], pageRefs: [], topic: "x" },
    ],
    flashcards: [
      { front: "Current", back: "Rate of flow of charge, $I = Q/t$.", pageRefs: [end] },
      { front: "Unit of charge", back: "Coulomb (C)", pageRefs: [] },
    ],
    ...overrides,
  };
}

import type { LessonPromptInput } from "@/lib/ai/prompts";
import { AiError, type LessonWriter, type WriterResult } from "@/server/ai/writer";
import type { QuestionsDraft } from "@/lib/ai/lesson-schema";

const usage = { inputTokens: 3000, outputTokens: 6000, cacheReadTokens: 1500, cacheWriteTokens: 0 };

/** A pretend Claude for tests: records what it was asked and returns canned lessons. */
export class FakeWriter implements LessonWriter {
  lessonCalls: LessonPromptInput[] = [];
  questionCalls: (LessonPromptInput & { avoid: string[] })[] = [];
  repairCalls = 0;
  /** Set to make the next lesson call fail or return something specific. */
  nextLesson: ((input: LessonPromptInput) => LessonDraft) | AiError | null = null;

  async writeLesson(input: LessonPromptInput): Promise<WriterResult<LessonDraft>> {
    this.lessonCalls.push(input);
    const next = this.nextLesson;
    this.nextLesson = null;
    if (next instanceof AiError) throw next;
    const value = next ? next(input) : sampleDraft(input.pageStart, input.pageEnd);
    return { value, calls: [{ value: null, model: "claude-sonnet-5-5", usage }] };
  }

  async writeQuestions(input: LessonPromptInput & { avoid: string[] }): Promise<WriterResult<QuestionsDraft>> {
    this.questionCalls.push(input);
    const q = sampleDraft(input.pageStart, input.pageEnd).questions.map((x, i) => ({ ...x, prompt: `${x.prompt} (new ${i})` }));
    return { value: { questions: q }, calls: [{ value: null, model: "claude-sonnet-5-5", usage }] };
  }

  async repairPage(): Promise<WriterResult<string>> {
    this.repairCalls += 1;
    return {
      value: "Ohm's law relates voltage, current and resistance: $$V = IR$$ and power is $$P = I^2 R$$. ".repeat(4),
      calls: [{ value: null, model: "claude-sonnet-5-5", usage: { inputTokens: 1700, outputTokens: 700 } }],
    };
  }
}
