import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { claudeEnabled, env } from "../env";
import { AiError, usageOf, type Call, type WriterResult } from "./writer";

/**
 * The tutoring assistant's calls: structured replies (curriculum units, draft
 * questions, summaries, wording) and a read-only tool loop for questions about
 * class data. Models are chosen per task for cost:
 *   "small" = Haiku (classification, wording, data lookups)
 *   "main"  = Sonnet (anything where quality matters: drafts, summaries)
 * In demo mode (FAKE_CLAUDE) each task returns its own demo value instead.
 */

export type Tier = "small" | "main";
export type StructuredTask<T> = { tier: Tier; system: string; user: string; schema: z.ZodType<T>; maxTokens?: number; demo: () => T };
export type Tool = { name: string; description: string; input_schema: Anthropic.Tool.InputSchema };
export type ToolTask = { tier: Tier; system: string; question: string; tools: Tool[]; runTool: (name: string, input: unknown) => Promise<unknown>; maxTurns?: number; demo: () => string };

export interface AssistantModel {
  structured<T>(task: StructuredTask<T>): Promise<WriterResult<T>>;
  withTools(task: ToolTask): Promise<WriterResult<string> & { toolCalls: { name: string; input: unknown }[] }>;
}

const modelFor = (tier: Tier) => (tier === "small" ? env.CLAUDE_MODEL_FLASHCARDS : env.CLAUDE_MODEL_GENERATION);

export class ClaudeAssistant implements AssistantModel {
  constructor(private client: Anthropic) {}

  async structured<T>(task: StructuredTask<T>): Promise<WriterResult<T>> {
    const model = modelFor(task.tier);
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: task.maxTokens ?? 8000,
        system: task.system,
        messages: [{ role: "user", content: task.user }],
        output_config: { format: zodOutputFormat(task.schema) },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      throw err instanceof Anthropic.APIError ? new AiError("retryable", "Claude is busy right now. Please try again in a minute.", err.message) : err;
    }
    const calls: Call<unknown>[] = [{ value: null, model: response.model ?? model, usage: usageOf(response.usage) }];
    if (response.stop_reason === "refusal") throw new AiError("refused", "Claude declined this request.", "refusal", calls);
    const reply = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    try {
      return { value: zodOutputFormat(task.schema).parse(reply) as T, calls };
    } catch (err) {
      throw new AiError("retryable", "Claude's reply couldn't be read. Please try again.", String(err).slice(0, 200), calls);
    }
  }

  async withTools(task: ToolTask) {
    const model = modelFor(task.tier);
    const calls: Call<unknown>[] = [];
    const toolCalls: { name: string; input: unknown }[] = [];
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: task.question }];
    for (let turn = 0; turn < (task.maxTurns ?? 6); turn++) {
      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({ model, max_tokens: 2000, system: task.system, tools: task.tools, messages });
      } catch (err) {
        throw err instanceof Anthropic.APIError ? new AiError("retryable", "Claude is busy right now. Please try again in a minute.", err.message, calls) : err;
      }
      calls.push({ value: null, model: response.model ?? model, usage: usageOf(response.usage) });
      if (response.stop_reason !== "tool_use") {
        const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
        return { value: text || "I couldn't find an answer to that.", calls, toolCalls };
      }
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        toolCalls.push({ name: block.name, input: block.input });
        let out: unknown;
        try {
          out = await task.runTool(block.name, block.input);
        } catch (err) {
          out = { error: err instanceof Error ? err.message : "failed" };
        }
        // Tool results are data (they can contain names students typed), never instructions.
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 20_000) });
      }
      messages.push({ role: "user", content: results });
    }
    return { value: "That needed too many lookups. Try a narrower question.", calls, toolCalls };
  }
}

/** Demo mode: each task's own demo value, no API calls, no cost. */
export class DemoAssistant implements AssistantModel {
  async structured<T>(task: StructuredTask<T>) {
    return { value: task.demo(), calls: [] };
  }
  async withTools(task: ToolTask) {
    return { value: task.demo(), calls: [], toolCalls: [] };
  }
}

let assistant: AssistantModel | null = null;
export function getAssistant(): AssistantModel {
  if (assistant) return assistant;
  if (env.FAKE_CLAUDE) return (assistant = new DemoAssistant());
  if (!claudeEnabled || !env.ANTHROPIC_API_KEY) throw new AiError("config", "The assistant isn't set up: the server has no ANTHROPIC_API_KEY.");
  return (assistant = new ClaudeAssistant(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 })));
}
