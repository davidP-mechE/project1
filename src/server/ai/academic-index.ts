import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { claudeEnabled, env } from "../env";
import { AiError, type WriterResult } from "./writer";
import { usageCalls } from "./grader";
import { ESSAY_GRADER_SYSTEM, EssayRunSchema, essayUserMessage, type EssayPromptInput, type EssayRun } from "@/lib/academic-index/essay-prompt";
import { EXTRACTION_SYSTEM, ExtractionSchema, FILE_TYPES, type Extraction, type FileType } from "@/lib/academic-index/extraction";

/**
 * Claude for the Academic Index: grading one essay with the fixed rubric (one
 * run; the caller runs it 3 times and keeps the medians), and reading an
 * application PDF's text into the fixed extraction schema. Tests and demo
 * mode use stand-ins, so they never call the API.
 *
 * The spec asks for temperature 0. Current Claude models don't accept a
 * temperature setting (thinking is always on), so stability comes from the
 * fixed, cached rubric, structured output and the median of 3 runs.
 */

export interface EssayGrader {
  readonly kind: "claude" | "demo";
  grade(input: EssayPromptInput): Promise<WriterResult<EssayRun>>;
}

export interface ApplicationReader {
  read(input: { fileType: FileType; pages: { page: number; text: string }[] }): Promise<WriterResult<Extraction>>;
}

function classify(err: unknown, what: string): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("config", `${what} isn't set up correctly on the server (the Claude API key was rejected).`, err.message);
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new AiError("retryable", "Claude is busy right now. Please try again in a minute.", err.message);
  }
  if (err instanceof Anthropic.BadRequestError) return new AiError("invalid", `${what} failed. Please try again.`, err.message);
  if (err instanceof Anthropic.APIError) return new AiError("retryable", `${what} failed. Please try again.`, `${err.status}: ${err.message}`);
  return new AiError("retryable", `${what} failed. Please try again.`, String(err));
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class ClaudeEssayGrader implements EssayGrader {
  readonly kind = "claude" as const;
  constructor(
    private readonly client: Anthropic,
    private readonly config: { model: string; effort: Effort },
  ) {}

  async grade(input: EssayPromptInput): Promise<WriterResult<EssayRun>> {
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.config.model,
          max_tokens: 16_000,
          // The rubric never changes, so it's cached across every essay.
          system: [{ type: "text", text: ESSAY_GRADER_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: essayUserMessage(input) }],
          output_config: { format: betaZodOutputFormat(EssayRunSchema), effort: this.config.effort },
          // If a safety classifier misreads an essay (they can be about hard topics), the API retries on a suitable model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: 180_000 },
      );
    } catch (err) {
      throw classify(err, "Essay scoring");
    }
    const calls = usageCalls(response, this.config.model);
    if (response.stop_reason === "refusal") throw new AiError("refused", "Claude declined to score this essay.", "refusal", calls);
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new AiError("retryable", "The essay couldn't be scored. Please try again.", `stop_reason ${response.stop_reason}`, calls);
    }
    return { value: response.parsed_output, calls };
  }
}

export class ClaudeApplicationReader implements ApplicationReader {
  constructor(
    private readonly client: Anthropic,
    private readonly config: { model: string; effort: Effort },
  ) {}

  async read(input: { fileType: FileType; pages: { page: number; text: string }[] }): Promise<WriterResult<Extraction>> {
    const text = input.pages.map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages
        .stream({
          model: this.config.model,
          max_tokens: 64_000,
          system: [{ type: "text", text: EXTRACTION_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: `The student says this file is: ${FILE_TYPES[input.fileType].long}.\nFill in the form from the document text below.\n\n<document>\n${text}\n</document>`,
            },
          ],
          output_config: { format: betaZodOutputFormat(ExtractionSchema), effort: this.config.effort },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
        .finalMessage();
    } catch (err) {
      throw classify(err, "Reading your PDF");
    }
    const calls = usageCalls(response, this.config.model);
    if (response.stop_reason === "refusal") throw new AiError("refused", "Claude declined to read this file. Enter the details by hand instead.", "refusal", calls);
    if (response.stop_reason === "max_tokens") throw new AiError("too_long", "This file is too long to read at once. Upload a shorter PDF, or enter the details by hand.", "max_tokens", calls);
    const reply = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return { value: ExtractionSchema.parse(JSON.parse(reply)), calls };
    } catch (err) {
      throw new AiError("retryable", "Claude's reply couldn't be read. Please try again.", `unparseable extraction: ${String(err).slice(0, 200)}`, calls);
    }
  }
}

/** Demo mode (FAKE_CLAUDE): fixed middling scores, labelled as a demo on the results page. */
export class DemoEssayGrader implements EssayGrader {
  readonly kind = "demo" as const;
  async grade(input: EssayPromptInput): Promise<WriterResult<EssayRun>> {
    const first = input.text.trim().split(/(?<=[.!?])\s+/)[0]?.split(/\s+/).slice(0, 12).join(" ") ?? "";
    const c = (score: number, suggestion: string) => ({ score, evidence: first, suggestion });
    return {
      calls: [],
      value: {
        voice: c(3, "Demo feedback: let more of how you actually think come through."),
        insight: c(3, "Demo feedback: say what changed in you, not only what happened."),
        detail: c(4, "Demo feedback: replace one general claim with a specific moment."),
        structure: c(3, "Demo feedback: make sure every paragraph moves the story forward."),
        clarity: c(4, "Demo feedback: read it aloud and fix sentences that trip you up."),
        answersPrompt: true,
        promptNote: "",
      },
    };
  }
}

const emptyField = { value: null, page: null, confidence: "low" as const };

/** Demo mode: an empty reading (nothing invented), so the student fills the form by hand. */
export class DemoApplicationReader implements ApplicationReader {
  async read(): Promise<WriterResult<Extraction>> {
    return {
      calls: [],
      value: {
        documentKind: "other",
        problem: "Demo mode doesn't read PDFs: enter your details by hand.",
        satSittings: [],
        actComposite: emptyField,
        gpa: { value: null, scale: null, weighting: "unknown", page: null, confidence: "low" },
        courses: [],
        apExams: [],
        ibExams: [],
        activities: [],
        honors: [],
        personalStatement: emptyField,
        supplements: [],
      },
    };
  }
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }));
const config = () => ({ model: env.CLAUDE_MODEL_ACADEMIC_INDEX, effort: env.CLAUDE_EFFORT_ACADEMIC_INDEX });

/** The essay grader, or null if Claude isn't set up (essays then stay "pending"). */
export function getEssayGrader(): EssayGrader | null {
  if (env.FAKE_CLAUDE) return new DemoEssayGrader();
  if (!claudeEnabled || !env.ANTHROPIC_API_KEY) return null;
  return new ClaudeEssayGrader(anthropic(), config());
}

export function getApplicationReader(): ApplicationReader {
  if (env.FAKE_CLAUDE) return new DemoApplicationReader();
  if (!claudeEnabled || !env.ANTHROPIC_API_KEY) throw new AiError("config", "Reading PDFs needs the server's ANTHROPIC_API_KEY. Enter your details by hand instead.");
  return new ClaudeApplicationReader(anthropic(), config());
}
