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
  repairKinds: string[] = [];
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

  assessmentCalls: import("@/lib/ai/assessment").AssessmentPromptInput[] = [];
  nextAssessment: AiError | null = null;
  async writeAssessment(input: import("@/lib/ai/assessment").AssessmentPromptInput) {
    this.assessmentCalls.push(input);
    if (this.nextAssessment) throw this.nextAssessment;
    const lo = Math.min(...input.lessons.map((l) => l.pageStart));
    const q = (i: number) => sampleDraft(lo, lo).questions[i % 3];
    return {
      value: {
        summary: input.kind === "UNIT_TEST" ? `- Key idea of ${input.unitTitle} (p. ${lo}).` : "ignored",
        questions: [...Array.from({ length: input.questionCount + 2 }, (_, i) => ({ ...q(i), prompt: `${input.kind} question ${i + 1}` })), { ...q(0), prompt: "bad", correctChoice: 9 }],
      },
      calls: [{ value: null, model: "claude-sonnet-5-5", usage: { inputTokens: 8000, outputTokens: 4000 } }],
    };
  }

  async repairPage(_png?: Buffer, kind: "book" | "slides" = "book"): Promise<WriterResult<string>> {
    this.repairCalls += 1;
    this.repairKinds.push(kind);
    return {
      value: "Ohm's law relates voltage, current and resistance: $$V = IR$$ and power is $$P = I^2 R$$. ".repeat(4),
      calls: [{ value: null, model: "claude-sonnet-5-5", usage: { inputTokens: 1700, outputTokens: 700 } }],
    };
  }
}

import type { Grader } from "@/server/ai/grader";
import type { GradeDraft } from "@/lib/grading/grade";
import type { GradingInput } from "@/lib/ai/grading-prompt";

/** A pretend grader: records what it was asked and returns a canned grade. */
export class FakeGrader implements Grader {
  readonly kind = "claude" as const;
  calls: GradingInput[] = [];
  next: GradeDraft | AiError = { verdict: "partially_correct", score: 0.5, feedback: "You named the idea but not the formula (p. 6)." };
  async grade(input: GradingInput): Promise<WriterResult<GradeDraft>> {
    this.calls.push(input);
    if (this.next instanceof AiError) throw this.next;
    return { value: this.next, calls: [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 2500, outputTokens: 300, cacheReadTokens: 900 } }] };
  }
}

import type { TutorAnswer, TutorModel } from "@/server/ai/tutor";
import type { TutorTurn } from "@/lib/tutor/prompt";
import type { Embedder, QueryEmbedder } from "@/server/embeddings/types";

/** A pretend tutor: records the conversation it was sent and streams a canned answer. */
export class FakeTutor implements TutorModel {
  readonly kind = "claude" as const;
  calls: TutorTurn[][] = [];
  reply = "Current is the rate of flow of charge [p. 5]. Also see [p. 99].";
  fail: AiError | null = null;
  async answer(messages: TutorTurn[], onText: (t: string) => void, signal: AbortSignal): Promise<TutorAnswer> {
    this.calls.push(messages);
    if (this.fail) throw this.fail;
    let text = "";
    for (const w of this.reply.split(/(?<= )/)) {
      if (signal.aborted) return { text, calls: [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 900, outputTokens: 5 } }], stop: "stopped" };
      text += w;
      onText(w);
      await Promise.resolve();
    }
    return { text, calls: [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 2500, outputTokens: 120, cacheReadTokens: 800 } }], stop: "done" };
  }
}

/** Deterministic stand-in for the embedding model: hashed bag of words, normalized (similar words → similar vectors). */
export function fakeVector(text: string): number[] {
  const v = new Array(384).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 384] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
export class FakeEmbedder implements Embedder, QueryEmbedder {
  readonly model = "Xenova/bge-small-en-v1.5";
  passages = 0;
  override: number[] | null | undefined = undefined; // set to force a query vector (or null = unavailable)
  async embedPassages(texts: string[]) {
    this.passages += texts.length;
    return texts.map(fakeVector);
  }
  async embedQuery(text: string) {
    return this.override === undefined ? fakeVector(text) : (this.override as number[]);
  }
}
