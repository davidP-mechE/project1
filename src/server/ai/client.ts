import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { claudeEnabled, env } from "../env";
import { DemoWriter } from "./demo-writer";
import { ClaudeGrader, DemoGrader, type Grader } from "./grader";
import { ClaudeTutor, DemoTutor, type TutorModel } from "./tutor";
import { AiError, ClaudeWriter, type LessonWriter } from "./writer";
import { ClaudeBatchRunner, InstantBatchRunner, type BatchRunner } from "./batch";

let writer: LessonWriter | null = null;
let grader: Grader | null = null;
let tutor: TutorModel | null = null;
let client: Anthropic | null = null;
let batchRunner: BatchRunner | null = null;

function anthropic(): Anthropic {
  if (!claudeEnabled || !env.ANTHROPIC_API_KEY) {
    throw new AiError("config", "Claude isn't set up: the server has no ANTHROPIC_API_KEY.");
  }
  // The API key is read from the server's environment only.
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
  return client;
}

/** The real Claude-backed lesson writer (or the free demo one with FAKE_CLAUDE=true). */
export function getWriter(): LessonWriter {
  if (env.FAKE_CLAUDE) {
    writer ??= new DemoWriter();
    return writer;
  }
  if (!claudeEnabled) {
    throw new AiError("config", "Lesson generation isn't set up: the server has no ANTHROPIC_API_KEY.");
  }
  writer ??= new ClaudeWriter(anthropic(), {
    model: env.CLAUDE_MODEL_GENERATION,
    fallbackModel: env.CLAUDE_MODEL_FALLBACK,
    flashcardModel: env.CLAUDE_MODEL_FLASHCARDS,
    flashcardEffort: env.CLAUDE_EFFORT_FLASHCARDS,
    visionModel: env.CLAUDE_MODEL_VISION,
    effort: env.CLAUDE_EFFORT_GENERATION,
  });
  return writer;
}

/** Grades written answers to practice questions. Null if Claude isn't set up (answers can still be self-checked). */
export function getGrader(): Grader | null {
  if (env.FAKE_CLAUDE) {
    grader ??= new DemoGrader();
    return grader;
  }
  if (!claudeEnabled) return null;
  grader ??= new ClaudeGrader(anthropic(), { model: env.CLAUDE_MODEL_GRADING, effort: env.CLAUDE_EFFORT_GRADING });
  return grader;
}

/** The "Ask the book" tutor. Null if Claude isn't set up. */
export function getTutor(): TutorModel | null {
  if (env.FAKE_CLAUDE) {
    tutor ??= new DemoTutor();
    return tutor;
  }
  if (!claudeEnabled) return null;
  tutor ??= new ClaudeTutor(anthropic(), { model: env.CLAUDE_MODEL_TUTOR, effort: env.CLAUDE_EFFORT_TUTOR });
  return tutor;
}

/** Sends whole-course generation through the Message Batches API (instantly, with the demo writer, in demo mode). */
export function getBatchRunner(): BatchRunner {
  if (batchRunner) return batchRunner;
  const w = getWriter();
  batchRunner = w instanceof ClaudeWriter ? new ClaudeBatchRunner(anthropic(), w) : new InstantBatchRunner(w);
  return batchRunner;
}

export const generationModel = () => ({
  model: env.FAKE_CLAUDE ? "demo" : env.CLAUDE_MODEL_GENERATION,
  effort: env.CLAUDE_EFFORT_GENERATION,
});
