import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AnalystPlan, CriticVerdict, ExtractorOutput, SafetyResult } from "../engine/schema";
import type { AnalystInput, CoachModel, CriticInput, ExtractInput, Turn, VoiceInput } from "../engine/model";
import { cardText } from "../engine/knowledge";
import { BANNED_PHRASES } from "../engine/critic-rules";

/**
 * The production CoachModel on Claude (spec: "Model strategy").
 *   main model (analyst, critic, voice): where quality matters most
 *   fast model (safety pre-screen, extractor): cheap, backed by the keyword screen
 * Analysis calls use structured outputs validated against the zod schemas; only
 * the voice call writes free text. Exact model IDs are pinned in the environment.
 *
 * Note: current models take no temperature setting, so consistency comes from
 * structured outputs, low effort on analysis calls and the critic loop.
 */

export type ClaudeConfig = { mainModel: string; fastModel: string; apiKey?: string };

export type CallLog = { role: string; model: string; input_tokens: number; output_tokens: number; ms: number };

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeCoachModel implements CoachModel {
  readonly name: string;
  private client: Anthropic;
  /** Every call's usage, for cost tracking and replay logs. */
  readonly calls: CallLog[] = [];

  constructor(private config: ClaudeConfig) {
    this.client = new Anthropic(config.apiKey ? { apiKey: config.apiKey } : {});
    this.name = `claude:${config.mainModel}+${config.fastModel}`;
  }

  private async structured<T>(role: string, opts: { model: string; system: string; user: string; schema: z.ZodType<T>; effort: "low" | "medium" | "high"; maxTokens?: number }): Promise<T> {
    const main = opts.model === this.config.mainModel;
    const started = Date.now();
    const params = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4000,
      system: [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: opts.user }],
      output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.effort },
      // On a policy decline the API re-runs the request on a fallback model.
      ...(main ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };
    // Retry once on an unreadable reply (spec: "retry or fall back on any invalid response").
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.beta.messages.parse(params as Parameters<typeof this.client.beta.messages.parse>[0]);
      this.calls.push({ role, model: res.model ?? opts.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ms: Date.now() - started });
      if (res.stop_reason === "refusal") throw new Error(`${role}: model declined`);
      const parsed = (res as { parsed_output?: T | null }).parsed_output;
      if (parsed) return parsed;
    }
    throw new Error(`${role}: invalid structured output`);
  }

  async safety(userText: string, history: Turn[]): Promise<SafetyResult> {
    return this.structured("safety", {
      model: this.config.fastModel,
      effort: "low",
      maxTokens: 600,
      schema: SafetyResult,
      system: SAFETY_SYSTEM,
      user: `${transcript(history.slice(-6))}\n\nNEW MESSAGE FROM USER:\n${userText}`,
    });
  }

  async extract(input: ExtractInput): Promise<ExtractorOutput> {
    return this.structured("extractor", {
      model: this.config.fastModel,
      effort: "low",
      maxTokens: 2000,
      schema: ExtractorOutput,
      system: EXTRACTOR_SYSTEM,
      user: [
        `Session stage: ${input.state.stage}.`,
        input.state.pending_insight ? `An insight is waiting for the user's verdict: "${input.state.pending_insight.statement}"` : "No insight is pending.",
        `Known so far: ${JSON.stringify(input.state.slots)}`,
        `Recent conversation:\n${transcript(input.history.slice(-8))}`,
        `Last thing the coach said: ${input.lastAssistant ?? "(nothing yet)"}`,
        `NEW USER MESSAGE:\n${input.userText}`,
      ].join("\n\n"),
    });
  }

  async analyse(input: AnalystInput): Promise<AnalystPlan> {
    const memory = input.memory;
    return this.structured("analyst", {
      model: this.config.mainModel,
      effort: "medium",
      maxTokens: 8000,
      schema: AnalystPlan,
      system: `${ANALYST_SYSTEM}\n\n# Policy\n${input.policy}`,
      user: [
        `# Directives from the state machine (binding)\n${input.directives.map((d) => `- ${d}`).join("\n")}`,
        `# Principle cards for this turn\n${input.cards.map(cardText).join("\n")}`,
        `# Session state\n${JSON.stringify({ stage: input.stage, slots: input.state.slots, hypotheses: input.state.hypotheses, last_probe: input.state.last_probe, reflective_streak: input.state.reflective_streak, permission: input.state.permission, rejected_count: input.state.rejected_count })}`,
        `# Extracted from the new message\n${JSON.stringify(input.extraction)}`,
        `# Memory (confirmed material only)\n${JSON.stringify({ similar_episodes: memory.episodes.map((e) => ({ id: e.episode_id, date: e.date, event: e.event, feelings: e.feelings, confirmed: e.hypotheses.filter((h) => h.confidence === "user_confirmed").map((h) => h.cause), plan: e.strategy_offered, outcome: e.strategy_outcome })), patterns: memory.patterns, open_plan: memory.openPlan, phrases: memory.phrases })}`,
        `# Recently used conversational moves (don't use the same one three times running)\n${input.ledger.moves.slice(-6).join(", ") || "none"}`,
        input.deeperChainAnalysis ? "# Advanced tier\nUse chain analysis where the situation repeats: background stress, trigger, thoughts, feelings, actions, aftermath." : "",
        `# Conversation\n${transcript(input.history.slice(-12))}\nUSER: ${input.userText}`,
      ].filter(Boolean).join("\n\n"),
    });
  }

  async voice(input: VoiceInput): Promise<string> {
    const started = Date.now();
    const examples = input.examples.map((conv) => conv.map((t) => `${t.role === "user" ? "USER" : "COACH"}: ${t.text}`).join("\n")).join("\n---\n");
    const res = await this.client.beta.messages.create({
      model: this.config.mainModel,
      max_tokens: 2000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: `${VOICE_SYSTEM}\n\n# Tone examples (do not copy wording)\n${examples}`, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            `# The plan to voice (decided already; do not change it)\n${JSON.stringify({ stage: input.stage, move: input.plan.move, intent: input.plan.intent, question: input.plan.question, insight: input.plan.insight, coaching: input.plan.coaching, hard_observation: input.plan.hard_observation })}`,
            input.memory.phrases.length ? `# The user's own phrases from before (use only if it fits naturally)\n${input.memory.phrases.map((p) => `"${p.phrase}" (${p.when})`).join(", ")}` : "",
            `# Openers used recently: do not start with any of these\n${input.recentlyUsed.slice(-20).join(" | ") || "none"}`,
            input.feedback.length ? `# Your previous draft was rejected for:\n${input.feedback.map((f) => `- ${f}`).join("\n")}` : "",
            input.voiceMode ? "# Spoken reply\nThis will be read aloud: under 45 words, no lists, nothing that only works on screen." : "",
            `# Conversation\n${transcript(input.history.slice(-8))}\nUSER: ${input.userText}`,
            "Write only the coach's reply.",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });
    this.calls.push({ role: "voice", model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ms: Date.now() - started });
    if (res.stop_reason === "refusal") throw new Error("voice: model declined");
    return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  }

  async critique(input: CriticInput): Promise<CriticVerdict> {
    return this.structured("critic", {
      model: this.config.mainModel,
      effort: "low",
      maxTokens: 2000,
      schema: CriticVerdict,
      system: CRITIC_SYSTEM,
      user: [
        `Stage: ${input.stage}. Plan: ${JSON.stringify({ move: input.plan.move, insight: input.plan.insight, coaching: input.plan.coaching, hard_observation: input.plan.hard_observation })}`,
        `What the user has actually said (all evidence must come from here):\n${transcript(input.history.filter((t) => t.role === "user").slice(-10))}\nUSER: ${input.userText}`,
        `Confirmed so far: ${JSON.stringify(input.state.hypotheses.filter((h) => h.confidence === "user_confirmed").map((h) => h.cause))}`,
        `DRAFT REPLY:\n${input.draft}`,
      ].join("\n\n"),
    });
  }
}

const transcript = (turns: Turn[]) => turns.map((t) => `${t.role === "user" ? "USER" : "COACH"}: ${t.text}`).join("\n") || "(start of conversation)";

// ─── Prompts (versioned with the code; each version's eval score is recorded) ───

export const PROMPT_VERSION = "2026-11-28.1";

const SAFETY_SYSTEM = `You screen messages sent to an emotional self-understanding coach for adults. Decide whether the newest user message signals that someone may be in danger: suicide or wanting to die (including indirect signs like "everyone would be better off without me", saying goodbye, giving things away), self-harm, abuse or being unsafe at home, intent to harm someone else, or a medical emergency. When in doubt, flag it: a false alarm costs little, a miss can cost a life. Separately, set wants_diagnosis if the user asks for a diagnosis, whether they have a condition, or medication advice. Ordinary strong emotions ("I could kill him, he's so annoying", "this job is killing me") are not crises unless there is real intent.`;

const EXTRACTOR_SYSTEM = `You read one message in a coaching conversation and return structured facts. Extract only what the user actually said or clearly implied; never invent. Feelings: use precise everyday labels (disappointed, embarrassed, left out, resentful...) with intensity 1-10 only if the user gave or clearly implied one; put vague words (bad, stressed, upset, off) in vague_feeling_words instead. Interpretation is what the user told themselves the event meant ("she didn't think about me"). People: "relation:Name" when both are known, otherwise whichever is known. Thinking traps only when clearly present. Verdict is the user's response to a pending insight or pattern; "partly" if they agree with a correction, and put the correction in their words. plan_outcome only if they report on an earlier plan.`;

const ANALYST_SYSTEM = `You are the analyst inside an emotional self-understanding coach. You do not talk to the user: you decide what the next turn should accomplish, and code checks your plan against the investigation rules.

Your job each turn:
- Keep 2-4 competing explanations once enough is known, each tied to one method (appraisal, cbt_chain, thinking_trap, needs, chain_analysis), with what would support or rule it out. Update each weight (0-1) from the evidence; be honest and calibrated, don't inflate. Never mark anything user_confirmed: only the user does that.
- Choose exactly one move allowed by the directives. Prefer concrete what/how questions over why questions. One question only. Set probe_hypothesis_id to the hypothesis the question tests.
- Offer an insight only when one explanation clearly leads on evidence from the user's own words. Phrase it as a possibility, with the reason.
- Coach only after a cause is confirmed: one or two concrete steps and an if-then plan.
- Be active: no more than two reflective turns in a row; contribute observations, gentle challenges, experiments, follow-ups. Use memory when it truly connects ("this sounds like..."), and list the episode or pattern IDs you used in references.
- Set hard_observation when the plan points out something uncomfortable (a contradiction, the user's own part); code will make sure permission is asked first.
- Never diagnose or use clinical labels. Never assume facts the user didn't state. List the principle cards you applied.`;

const VOICE_SYSTEM = `You are the voice of an AI coach for emotional self-understanding. You turn an approved plan into a short, warm, plain-language reply. You are honest that you're an AI and never pretend to be human or a friend.

Rules:
- Say what the plan says, nothing more: don't add questions, insights or advice it doesn't contain. Exactly one question unless the plan has none.
- Reference something specific the user said. Use their own words and register; contractions; no therapy-speak.
- Match the user's length: short message, short reply. No bullet points or lists. No emojis.
- Never use stock phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.
- An insight is a possibility, gives its reason, and ends with "Does that fit?"
- A coaching turn includes the if-then plan as "If ..., then I'll ..." and invites the user to word it their own way.
- If the plan has a hard observation and permission hasn't been given, only ask permission: "Can I point out something I'm noticing?"
- No dependency language ("I'm always here for you"), no flattery without a specific reason, no diagnosis words.`;

const CRITIC_SYSTEM = `You check a draft reply from an emotional self-understanding coach before it is sent. Fail it (pass=false) with short, specific problems if it does any of these:
- overclaims: states a cause as fact rather than a possibility, or claims certainty the evidence doesn't support
- uses diagnosis or clinical language, or gives medical advice
- asks a leading question that pushes the user toward a conclusion
- assumes something the user never said (check against the user's messages)
- is sycophantic: agrees with a claim the evidence doesn't support, praises without a reason, or drops an insight just because the user objected without new evidence
- uses stock empathy phrases or reads like a script
- asks more than one question, or uses lists
- lectures, piles on a second uncomfortable truth, or attacks the person rather than the story
Pass it if none apply. Do not rewrite the reply.`;
