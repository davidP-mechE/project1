import type { FlashcardsDraft, LessonDraft, QuestionsDraft } from "@/lib/ai/lesson-schema";
import type { LessonPromptInput } from "@/lib/ai/prompts";
import { pageText } from "@/lib/ai/source";
import type { LessonWriter, WriterResult } from "./writer";
import type { AssessmentDraft, AssessmentPromptInput } from "@/lib/ai/assessment";
import type { WorksheetDraft, WorksheetPage } from "@/lib/ai/worksheet";

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
    const deck = input.sourceKind === "slides";
    const word = deck ? "slides" : "pages";
    const cite = (n: number) => (deck ? `(slide ${n})` : `(p. ${n})`);
    const pick = (i: number) => all[i % Math.max(1, all.length)] ?? { s: input.lessonTitle, page: first };
    const value: LessonDraft = {
      sourceCheck: { usable: true, problem: "" },
      objectives: [`Describe the main ideas of "${input.lessonTitle}".`, `Recall the key terms from these ${word}.`],
      explanation: [
        "> **Demo lesson.** This placeholder was assembled from sentences in the book without using Claude (FAKE_CLAUDE=true). Real lessons are written by Claude.",
        "",
        deck ? "### From the slides" : "### From the book",
        "",
        ...all.slice(0, 6).map((x) => `${x.s} ${cite(x.page)}`),
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
          prompt: `Which lesson covers ${word} ${input.pageStart}–${input.pageEnd}? (demo question)`,
          choices: [input.lessonTitle, "The index", "The preface", `None of these ${word}`],
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
      flashcards: [], // written by writeFlashcards, like the real writer
    };
    return { value, calls: [{ value: null, model: "demo", usage: noUsage }] };
  }

  async writeFlashcards(input: LessonPromptInput): Promise<WriterResult<FlashcardsDraft>> {
    const all = input.pages.flatMap((p) => sentences(pageText(p)).map((s) => ({ s, page: p.pageNumber })));
    return {
      value: { flashcards: all.slice(0, 3).map((x, i) => ({ front: `Demo card ${i + 1}`, back: x.s, pageRefs: [x.page] })) },
      calls: [{ value: null, model: "demo", usage: noUsage }],
    };
  }

  async writeQuestions(input: LessonPromptInput & { avoid: string[] }): Promise<WriterResult<QuestionsDraft>> {
    const lesson = await this.writeLesson(input);
    return {
      value: { questions: lesson.value.questions.map((q) => ({ ...q, prompt: `${q.prompt} (new)` })) },
      calls: lesson.calls,
    };
  }

  async writeAssessment(input: AssessmentPromptInput): Promise<WriterResult<AssessmentDraft>> {
    await wait(800);
    const titles = input.lessons.map((l) => l.title);
    const questions: AssessmentDraft["questions"] = [];
    input.lessons.forEach((l, i) => {
      const others = titles.filter((t) => t !== l.title);
      const wrong = [...others, "The index", "The preface", "The glossary"].slice(0, 3);
      const choices = [l.title, ...wrong];
      const correct = i % choices.length;
      [choices[0], choices[correct]] = [choices[correct], choices[0]];
      questions.push({
        type: "multiple_choice",
        prompt: `Which lesson covers pages ${l.pageStart}–${l.pageEnd}? (demo test question)`,
        choices,
        correctChoice: correct,
        answer: l.title,
        explanation: "Demo question: it's the lesson with those pages.",
        steps: [],
        pageRefs: [l.pageStart],
        topic: l.title.slice(0, 40),
      });
      const term = l.content.keyTerms[0];
      if (term) {
        questions.push({
          type: "short_answer",
          prompt: `In your own words, what is "${term.term}"? (demo test question)`,
          choices: [],
          correctChoice: -1,
          answer: term.definition,
          explanation: "Any answer close to the definition in the lesson.",
          steps: [],
          pageRefs: [l.pageStart],
          topic: term.term.slice(0, 40),
        });
      }
    });
    const summary =
      input.kind === "UNIT_TEST"
        ? ["> **Demo summary** (not written by Claude).", "", ...input.lessons.map((l) => `- **${l.title}**: ${l.content.objectives[0] ?? "see the lesson"} (p. ${l.pageStart})`)].join("\n")
        : "";
    return { value: { summary, questions: questions.slice(0, input.questionCount) }, calls: [{ value: null, model: "demo", usage: noUsage }] };
  }

  /** Demo: numbered lines ("3. …") become questions; "A) …" lines under one become its choices (the first is "right"). */
  async readWorksheet(_title: string, pages: WorksheetPage[]): Promise<WriterResult<WorksheetDraft>> {
    await wait(800);
    const items: WorksheetDraft["items"] = [];
    for (const p of pages) {
      for (const line of p.text.split(/\n/).map((l) => l.trim())) {
        const q = /^(\d+[a-z]?)[.)]\s+(.{3,})$/.exec(line);
        const c = /^\(?([A-D])[.)]\s+(.+)$/.exec(line);
        if (q) {
          items.push({ label: q[1], type: "short_answer", prompt: `${q[2]} (demo)`, choices: [], correctChoice: -1, answer: "Demo answer", answerFromWorksheet: false, explanation: "Demo mode: answers aren't worked out.", steps: [], pageRefs: [p.pageNumber], topic: "Demo skill", satDomain: "algebra", satSkill: "Linear equations in one variable", difficulty: "medium", desmosSolvable: false });
        } else if (c && items.length > 0) {
          const last = items[items.length - 1];
          last.type = "multiple_choice";
          last.choices.push(c[2]);
          last.correctChoice = 0;
          last.answer = last.choices[0];
        }
      }
    }
    return { value: { readable: items.length > 0, problem: items.length ? "" : "Demo mode found no numbered questions.", hasAnswerKey: false, items }, calls: [{ value: null, model: "demo", usage: noUsage }] };
  }

  async repairPage(): Promise<WriterResult<string>> {
    return { value: "", calls: [] }; // demo mode keeps the extracted text
  }
}
