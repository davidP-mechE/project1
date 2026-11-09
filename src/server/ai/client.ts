import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { claudeEnabled, env } from "../env";
import { DemoWriter } from "./demo-writer";
import { ClaudeGrader, DemoGrader, type Grader } from "./grader";
import { AiError, ClaudeWriter, type LessonWriter } from "./writer";

let writer: LessonWriter | null = null;
let grader: Grader | null = null;
let client: Anthropic | null = null;

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

export const generationModel = () => ({
  model: env.FAKE_CLAUDE ? "demo" : env.CLAUDE_MODEL_GENERATION,
  effort: env.CLAUDE_EFFORT_GENERATION,
});
