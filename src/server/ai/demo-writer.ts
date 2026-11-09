import type { LessonDraft, QuestionsDraft } from "@/lib/ai/lesson-schema";
import type { LessonPromptInput } from "@/lib/ai/prompts";
import { pageText } from "@/lib/ai/source";
import type { LessonWriter, WriterResult } from "./writer";

/**
 * DEMO MODE (FAKE_CLAUDE=true, development only): builds placeholder lessons
 * from the book's own sentences without calling Claude, so you can try the
 * whole app for free. Every demo lesson says clearly that it's a demo.
 */

const sentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 300);

const noUsage = { inputTokens: 0, outputTokens: 0 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DemoWriter implements LessonWriter {
  async writeLesson(input: LessonPromptInput): Promise<WriterResult<LessonDraft>> {
    await wait(1500); // feel a little like real generation
    const pages = input.pages.filter((p) => pageText(p).length > 0);
    const all = pages.flatMap((p) => sentences(pageText(p)).map((s) => ({ s, page: p.pageNumber })));
    const first = pages[0]?.pageNumber ?? input.pageStart;
    const pick = (i: number) => all[i % Math.max(1, all.length)] ?? { s: input.lessonTitle, page: first };
    const value: LessonDraft = {
      sourceCheck: { usable: true, problem: "" },
      objectives: [`Describe the main ideas of "${input.lessonTitle}".`, "Recall the key terms from these pages."],
      explanation: [
        "> **Demo lesson.** This placeholder was assembled from sentences in the book without using Claude (FAKE_CLAUDE=true). Real lessons are written by Claude.",
        "",
        "### From the book",
        "",
        ...all.slice(0, 6).map((x) => `${x.s} (p. ${x.page})`),
        "",
        "### A formula, to check math display",
        "",
        "$$I = \\frac{Q}{t}$$",
      ].join("\n\n"),
      workedExamples: [],
      keyTerms: [{ term: input.lessonTitle.replace(/^[\d.]+\s*/, ""), definition: pick(0).s, pageRefs: [pick(0).page] }],
      questions: [
        {
          type: "multiple_choice",
          prompt: `Which lesson covers pages ${input.pageStart}–${input.pageEnd}? (demo question)`,
          choices: [input.lessonTitle, "The index", "The preface", "None of these pages"],
          correctChoice: 0,
          answer: input.lessonTitle,
          explanation: "This is a demo question.",
          steps: [],
          pageRefs: [first],
          topic: "Demo",
        },
        {
          type: "short_answer",
          prompt: "Summarise one idea from this lesson in your own words. (demo question)",
          choices: [],
          correctChoice: -1,
          answer: pick(1).s,
          explanation: "Any idea from the pages is fine in demo mode.",
          steps: [],
          pageRefs: [pick(1).page],
          topic: "Demo",
        },
      ],
      flashcards: all.slice(0, 3).map((x, i) => ({ front: `Demo card ${i + 1}`, back: x.s, pageRefs: [x.page] })),
    };
    return { value, calls: [{ value: null, model: "demo", usage: noUsage }] };
  }

  async writeQuestions(input: LessonPromptInput & { avoid: string[] }): Promise<WriterResult<QuestionsDraft>> {
    const lesson = await this.writeLesson(input);
    return {
      value: { questions: lesson.value.questions.map((q) => ({ ...q, prompt: `${q.prompt} (new)` })) },
      calls: lesson.calls,
    };
  }

  async repairPage(): Promise<WriterResult<string>> {
    return { value: "", calls: [] }; // demo mode keeps the extracted text
  }
}
