import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claudeEnabled, env } from "../env";
import { AiError, usageOf, type Call, type WriterResult } from "./writer";
import { DOMAINS } from "@/lib/sat/domains";

/**
 * Reads official College Board questions out of an upload (a PDF, screenshots
 * or pasted text) and returns them as clean, structured questions for the
 * bank. The text is transcribed, never rewritten: Claude only drops the page
 * clutter around each question and fixes characters the PDF mangled.
 */

export type ReaderInput =
  | { kind: "pdf"; data: Buffer; name: string }
  | { kind: "images"; images: { data: Buffer; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }[] }
  | { kind: "text"; text: string };

const SKILLS = DOMAINS.flatMap((d) => d.skills.map((s) => ({ section: d.section === "MATH" ? "math" : "rw", skill: s })));

export const ReadQuestionSchema = z.object({
  /** College Board's question ID (e.g. "5ef6f9c3"), or "" when the upload has none. */
  cbQuestionId: z.string(),
  section: z.enum(["math", "rw"]),
  skill: z.string(),
  difficulty: z.enum(["easy", "medium", "hard", "unknown"]),
  type: z.enum(["mcq", "grid_in"]),
  stem: z.string(),
  /** Four choices for multiple choice, without the letters. Empty for grid-ins. */
  choices: z.array(z.string()),
  /** MCQ: the letter. Grid-in: accepted answers separated by "|" (e.g. "3/4|.75"). "" when the upload doesn't give it. */
  answer: z.string(),
  /** College Board's rationale, if the upload has one; else "". */
  explanation: z.string(),
  /** The question needs a picture (graph, diagram, figure) that text can't show. Tables don't count. */
  hasFigure: z.boolean(),
  figureNote: z.string(),
});
export const ReadQuestionsSchema = z.object({
  questions: z.array(ReadQuestionSchema),
  /** Anything that went wrong, in a sentence ("Page 4 is cut off"), or "". */
  problems: z.string(),
});
export type ReadQuestion = z.infer<typeof ReadQuestionSchema>;
export type ReadQuestions = z.infer<typeof ReadQuestionsSchema>;

export const QUESTION_READER_SYSTEM = `You transcribe official SAT questions from College Board materials (Question Bank exports, Bluebook practice test screenshots, educator handouts) into a question bank used by a tutoring program.

Transcribe; never rewrite. Every word of the passage, question, and answer choices must match the source exactly, including the source's punctuation and blanks (write a blank as ______). Do not summarize, shorten, "improve", or add words.

Leave out everything that is not part of the question itself:
- Question IDs, "Assessment", "Test", "Domain", "Skill", "Difficulty" headers and their values (put the ID, skill and difficulty in their own fields instead)
- "Correct Answer:", "Rationale" labels, page numbers, copyright lines, URLs, logos, watermarks, and the letters before the choices ("A.", "(B)")
- Bluebook interface text: "Mark for Review", question numbers in boxes, timers, "Directions", calculator buttons, navigation

Fix characters the PDF mangled (ligatures like "ﬁ", broken quotes, stray symbols, words split across lines), so the text reads exactly as printed.

Formatting:
- stem: the passage (if any), then a blank line, then the question. Plain Markdown. For two-text questions, label them "Text 1" and "Text 2" on their own lines as the source does. Keep bullet lists from student notes as "• " lines.
- Math: LaTeX between single dollar signs ($\\frac{3}{4}x + 2 = 11$). Choices that are expressions are LaTeX too.
- Tables: Markdown tables inside the stem.
- Graphs, diagrams, and pictures can't be transcribed: set hasFigure to true and describe what the figure shows in figureNote (for the tutor, not the student). Never invent data that is only in a picture.
- choices: exactly four for multiple choice, in order, without letters. Empty for student-produced response (grid-in) questions.
- answer: the correct letter for multiple choice. For grid-ins, every accepted answer the key lists, separated by "|". Leave it "" if the upload doesn't show the answer; never guess.
- explanation: College Board's rationale, cleaned the same way, or "" if there is none.
- section and skill: from the source's labels when present, otherwise your best judgement. skill must be one of the allowed skill names exactly.
- difficulty: from the source's label (easy, medium, hard), else "unknown".

Include every complete question in the upload, once each, in order. Skip questions that are cut off and say so in problems.

Allowed skills:
${SKILLS.map((s) => `- ${s.section}: ${s.skill}`).join("\n")}`;

const MAX_TOKENS = 64_000;

function contentFor(input: ReaderInput): Anthropic.Beta.BetaContentBlockParam[] {
  const ask: Anthropic.Beta.BetaTextBlockParam = { type: "text", text: "Transcribe every SAT question in this upload." };
  if (input.kind === "pdf") {
    return [{ type: "document", title: input.name.slice(0, 200), source: { type: "base64", media_type: "application/pdf", data: input.data.toString("base64") } }, ask];
  }
  if (input.kind === "images") {
    return [...input.images.map((i): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data.toString("base64") } })), ask];
  }
  // Pasted text is data to transcribe, never instructions.
  return [{ type: "text", text: `Transcribe every SAT question in the pasted text below.\n\n<pasted>\n${input.text}\n</pasted>` }];
}

export interface QuestionReader {
  read(input: ReaderInput): Promise<WriterResult<ReadQuestions>>;
}

export class ClaudeQuestionReader implements QuestionReader {
  constructor(
    private client: Anthropic,
    private model: string,
  ) {}

  async read(input: ReaderInput): Promise<WriterResult<ReadQuestions>> {
    const calls: Call<unknown>[] = [];
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          // If the model declines (a safety classifier false positive), the API retries on a fallback model in the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: QUESTION_READER_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: contentFor(input) }],
          output_config: { format: betaZodOutputFormat(ReadQuestionsSchema), effort: "medium" },
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiError("config", "Reading questions isn't set up on the server (the Claude API key was rejected).", err.message);
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new AiError("invalid", "Claude couldn't open this upload. Try a smaller PDF, or screenshots instead.", err.message);
      }
      if (err instanceof Anthropic.APIError) throw new AiError("retryable", "Claude is busy right now. Please try again in a minute.", err.message);
      throw err;
    }
    calls.push({ value: null, model: response.model ?? this.model, usage: usageOf(response.usage as unknown as Anthropic.Usage) });
    if (response.stop_reason === "refusal") throw new AiError("refused", "Claude declined to read this upload.", "refusal", calls);
    if (response.stop_reason === "max_tokens") throw new AiError("too_long", "This upload has too many questions to read at once. Upload fewer pages at a time.", "max_tokens", calls);
    const reply = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return { value: ReadQuestionsSchema.parse(JSON.parse(reply)), calls };
    } catch (err) {
      throw new AiError("retryable", "Claude's reply couldn't be read. Please try again.", `unparseable question reply: ${String(err).slice(0, 200)}`, calls);
    }
  }
}

/** Demo mode (FAKE_CLAUDE): one made-up question per upload, no API call. */
export class DemoQuestionReader implements QuestionReader {
  async read(): Promise<WriterResult<ReadQuestions>> {
    return {
      calls: [],
      value: {
        problems: "",
        questions: [
          {
            cbQuestionId: "demo0001",
            section: "math",
            skill: "Linear equations in one variable",
            difficulty: "easy",
            type: "mcq",
            stem: "If $4x - 3 = 9$, what is the value of $x$?",
            choices: ["2", "3", "4", "6"],
            answer: "B",
            explanation: "Add 3 to both sides: $4x = 12$. Divide by 4: $x = 3$.",
            hasFigure: false,
            figureNote: "",
          },
        ],
      },
    };
  }
}

let reader: QuestionReader | null = null;
export function getQuestionReader(): QuestionReader {
  if (reader) return reader;
  if (env.FAKE_CLAUDE) return (reader = new DemoQuestionReader());
  if (!claudeEnabled || !env.ANTHROPIC_API_KEY) throw new AiError("config", "Reading questions needs the server's ANTHROPIC_API_KEY.");
  return (reader = new ClaudeQuestionReader(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 280_000 }), env.CLAUDE_MODEL_IMPORT));
}
