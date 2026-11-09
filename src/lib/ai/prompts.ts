import { CONTENT_TYPES, has, LEVELS, questionTypesOn, STYLES, type CourseSettings } from "@/lib/course/settings";
import { formatSourcePages, type SourcePage } from "./source";

/**
 * Prompts for lesson generation.
 *
 * The system prompt never changes (no dates, names or settings in it), so
 * Claude's prompt cache can reuse it across every lesson of every course,
 * which makes that part ~10x cheaper. Everything that varies goes in the
 * user message: the book's pages first, then the instructions for this
 * lesson.
 *
 * Bump PROMPT_VERSION when you change a prompt: it's part of each lesson's
 * cache key, so lessons are only regenerated when asked, but you can tell
 * which ones were written with the old prompt.
 */
export const PROMPT_VERSION = "lesson-v1";

export const LESSON_SYSTEM_PROMPT = `You write lessons for Coursebook, an app that turns a textbook into a self-paced course for students studying on their own.

You receive the text of one section of a textbook, page by page. Each page begins with a marker like "=== Page 47 ===". Write the lesson from that text only.

<staying_true_to_the_book>
- Use only facts, definitions, formulas, numbers and examples that appear in the provided pages. You may explain, rephrase, reorder and connect ideas so they're easier to learn, and add ordinary connecting language, but do not add facts, formulas, dates or details from outside the pages, even ones you know to be true.
- If the pages and your own knowledge disagree, follow the pages.
- Every practice question must be answerable from the pages alone.
- Worked examples: include only examples that appear in the pages (you may lay out their steps more clearly). If the pages contain no worked examples, return an empty list.
- Page references: every worked example, key term, question and flashcard lists the page numbers (taken from the markers) where its content appears. In the explanation, cite pages in parentheses after the ideas they support, like (p. 47) or (pp. 47–48).
- If the pages don't contain enough readable text to teach from (for example they are mostly figure labels, broken equations, a list of contents, or garbled characters), set sourceCheck.usable to false, describe the problem in one or two sentences in sourceCheck.problem, and leave every other field empty. Do not guess at missing content.
- The text was extracted from a PDF and may contain broken line breaks, stray characters or running headers. Quietly fix obvious extraction errors, but never invent content that is missing.
</staying_true_to_the_book>

<writing_for_a_student_studying_alone>
- Write directly to the student ("you"). Be clear, warm and precise.
- The explanation is Markdown: short paragraphs, "###" subheadings for major ideas, lists where they help, and **bold** for important terms the first time they appear. Don't start with a heading that repeats the lesson title, and don't repeat the worked examples, key terms or questions inside the explanation (they're shown separately).
- Write all math in LaTeX: $...$ inline and $$...$$ on its own line for displayed equations. Keep the book's notation and symbols.
- Learning objectives begin with an action verb ("Explain…", "Calculate…") and say what the student will be able to do.
</writing_for_a_student_studying_alone>

<practice_questions>
- multiple_choice: exactly 4 choices with one correct answer; correctChoice is its 0-based index. Wrong choices should be believable mistakes. Never use "all of the above" or "none of the above". Vary the position of the correct answer.
- short_answer: answerable in one to three sentences. "answer" is a model answer; "explanation" says what a good answer must include.
- step_by_step: a problem to work through (usually a calculation or procedure) using the pages. "steps" is the full worked solution, one step per item; "answer" is the final result with units.
- For questions that aren't multiple choice, use an empty choices list and correctChoice -1. For questions that aren't step-by-step, use an empty steps list.
- "explanation" says why the answer is right, so a student who got it wrong can learn from it.
- "topic" is a 2–5 word label for the idea being tested, such as "Ohm's law".
- Order questions from recall to application.
</practice_questions>

<flashcards>
- Front: a term or a short question. Back: a short answer (one or two sentences, or a formula).
- Choose ideas worth remembering, not trivia.
</flashcards>`;

const LEVEL_GUIDANCE: Record<CourseSettings["level"], string> = {
  middle_school: "Use simple words and short sentences. Explain any term a 12–14 year old might not know, and show every arithmetic step.",
  high_school: "Assume a high-school student. Explain new terms when they first appear and show algebra steps.",
  college: "Assume an introductory college student. Be precise and efficient, and use standard notation.",
};

const STYLE_GUIDANCE: Record<CourseSettings["style"], string> = {
  concise: "Keep the explanation brief: the essential ideas and how they connect, roughly 300–600 words.",
  detailed: "Teach thoroughly: build each idea step by step with intuition and the book's own examples, roughly 700–1,400 words (less if the section is short).",
};

const QUESTION_TYPE_NAMES = {
  multipleChoice: "multiple_choice",
  shortAnswer: "short_answer",
  stepProblems: "step_by_step",
} as const;

export type LessonPromptInput = {
  courseTitle: string;
  unitTitle: string;
  lessonTitle: string;
  pageStart: number;
  pageEnd: number;
  pages: SourcePage[];
  settings: CourseSettings;
  /** Lecture slides instead of a textbook: each "page" is one slide. */
  sourceKind?: "book" | "slides";
  /** Review: write every question on this one skill (topic), to drill it. */
  focus?: string;
};

/** Extra instructions for lecture slides (kept out of the cached system prompt). */
const SLIDES_NOTE = `These "pages" are lecture slides: "=== Page 12 ===" is slide 12, and they may include the presenter's speaker notes and [Figure: …] descriptions of the slide's pictures. Slides are terse, so turn their bullet points into a clear, connected explanation a student could learn from without the lecture: say what each point means and how the points relate. The grounding rules still apply: don't add facts, formulas or examples that aren't on the slides or in the notes. In the explanation, cite slides like (slide 12) or (slides 12–14) instead of (p. 12). Page reference lists still use the slide numbers.`;

const slidesNote = (input: LessonPromptInput) => (input.sourceKind === "slides" ? `\n\n${SLIDES_NOTE}` : "");

function settingsLines(s: CourseSettings, opts: { questionsOnly?: boolean } = {}): string[] {
  const lines = [
    `- Student level: ${LEVELS[s.level].toLowerCase()}. ${LEVEL_GUIDANCE[s.level]}`,
  ];
  if (!opts.questionsOnly) {
    lines.push(`- Explanation style: ${STYLES[s.style].label.toLowerCase()}. ${STYLE_GUIDANCE[s.style]}`);
    lines.push(
      has(s, "objectives") ? "- Learning objectives: 3 to 5." : "- Learning objectives: not wanted; return an empty list.",
      has(s, "workedExamples")
        ? "- Worked examples: include the book's worked examples from these pages (empty list if there are none)."
        : "- Worked examples: not wanted; return an empty list.",
      has(s, "keyTerms")
        ? "- Key terms: the important terms these pages define, with definitions based on the pages."
        : "- Key terms: not wanted; return an empty list.",
    );
  }
  const qTypes = questionTypesOn(s);
  if (qTypes.length === 0) {
    lines.push("- Practice questions: not wanted; return an empty list.");
  } else {
    const names = qTypes.map((t) => QUESTION_TYPE_NAMES[t]).join(", ");
    const stepNote = qTypes.includes("stepProblems")
      ? " Only use step_by_step when the pages contain calculations or procedures to practise; otherwise use the other types."
      : "";
    lines.push(`- Practice questions: exactly ${s.questionsPerLesson}, mixing these types: ${names}.${stepNote}`);
  }
  if (!opts.questionsOnly) {
    lines.push(
      has(s, "flashcards") && s.flashcardsPerLesson > 0
        ? `- Flashcards: ${s.flashcardsPerLesson}.`
        : "- Flashcards: not wanted; return an empty list.",
    );
  }
  return lines;
}

function header(input: LessonPromptInput): string {
  const word = input.sourceKind === "slides" ? "slide" : "page";
  const range = input.pageStart === input.pageEnd ? `${word} ${input.pageStart}` : `${word}s ${input.pageStart}–${input.pageEnd}`;
  return `${input.sourceKind === "slides" ? "Slide deck" : "Textbook"}: "${input.courseTitle}"\nUnit: "${input.unitTitle}"\nLesson: "${input.lessonTitle}" (${range})`;
}

/** The user message for writing a full lesson: source pages first, then the task. */
export function lessonUserMessage(input: LessonPromptInput): string {
  return `<book_pages>
${formatSourcePages(input.pages)}
</book_pages>

${header(input)}${slidesNote(input)}

Write this lesson from the pages above, following these settings:
${settingsLines(input.settings).join("\n")}

Cite only pages ${input.pageStart}–${input.pageEnd}.`;
}

/** The user message for regenerating only the practice questions. */
export function questionsUserMessage(input: LessonPromptInput & { avoid: string[] }): string {
  const avoid =
    input.avoid.length > 0
      ? `\n\nThe student has already seen these questions. Write different ones (you may test the same ideas in new ways):\n${input.avoid.map((q) => `- ${q}`).join("\n")}`
      : "";
  return `<book_pages>
${formatSourcePages(input.pages)}
</book_pages>

${header(input)}${slidesNote(input)}

Write only practice questions for this lesson from the pages above. Set sourceCheck as usual.${
    input.focus
      ? ` Every question must test the skill "${input.focus.replace(/"/g, "'")}" (set each question's topic to exactly that), from different angles: definitions, applying it, spotting mistakes, and problems like the pages' examples with new numbers where the pages give a method.`
      : ""
  } Settings:
${settingsLines(input.settings, { questionsOnly: true }).join("\n")}

Cite only pages ${input.pageStart}–${input.pageEnd}.${avoid}`;
}

/** Instructions for re-reading an equation-heavy page from its image. */
export const PAGE_REPAIR_PROMPT = `This image is one page of a textbook. Transcribe its text exactly, in reading order.

- Write all math in LaTeX: $...$ inline and $$...$$ on its own line for displayed equations.
- Leave out running headers, footers and page numbers.
- For a figure or diagram, write [Figure: one-line description of what it shows], including any labels you can read. Do not invent values.
- For a table, use a Markdown table.
- If part of the page is unreadable, write [unreadable] there rather than guessing.

Reply with the transcription only, with no introduction or comments.`;

/** Instructions for reading a lecture slide that is mostly pictures (diagrams, charts, photos). */
export const SLIDE_READ_PROMPT = `This image is one slide from a lecture. Write out what a student needs from it, in reading order.

- Transcribe all of the slide's text exactly, title first. Write math in LaTeX: $...$ inline, $$...$$ displayed.
- For each diagram, chart, graph, table or photo that carries meaning, write [Figure: …] with one to three sentences on what it shows: its labels, axes, values, arrows and the relationship it illustrates. Do not invent values you can't read.
- Leave out logos, decorations, slide numbers and footers.
- If part of the slide is unreadable, write [unreadable] there rather than guessing.

Reply with the text only, with no introduction or comments.`;

export const contentTypeLabel = (t: keyof typeof CONTENT_TYPES) => CONTENT_TYPES[t].label;
