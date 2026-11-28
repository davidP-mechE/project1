import type { AnalystPlan, Episode, ExtractorOutput, SafetyResult, SessionState, Stage } from "./schema";
import type { CoachModel, Ledger, Memory, Turn } from "./model";
import { keywordScreen, mergeSafety, crisisReply, DIAGNOSIS_REPLY } from "./safety";
import { afterReply, applyExtraction, enforcePlan, leader, missingSlots, resolvePermission, resolveVerdict, stageForTurn, ALLOWED_MOVES } from "./stages";
import { checkDraft, openerOf, type RuleResult } from "./critic-rules";
import { cardsFor, examplesFor, loadKnowledge } from "./knowledge";

/**
 * The turn pipeline (spec: "How each turn is processed"):
 *   safety screen → extractor → analyst → (code enforces the stage) → voice → critic
 * The critic can send a draft back up to MAX_REWRITES times; after that the
 * analyst re-plans once; after that a plain, rule-safe fallback is used.
 */

export const MAX_REWRITES = 2;

export type TurnOptions = {
  fullPipeline: boolean;
  deeperChainAnalysis: boolean;
  country?: string | null;
  firstSession?: boolean;
  voiceMode?: boolean;
  now?: Date;
};

export type TurnTrace = {
  safety: SafetyResult;
  extraction: ExtractorOutput | null;
  stage: Stage;
  plan: AnalystPlan | null;
  corrections: string[];
  attempts: { draft: string; problems: string[] }[];
  flags: RuleResult["flags"] | null;
  fallback: boolean;
  model: string;
  ms: number;
};

export type TurnResult = {
  reply: string;
  state: SessionState;
  trace: TurnTrace;
  /** Written when the session reaches the record stage. */
  episode: Episode | null;
  /** Outcome of the open plan, when the user reported one this turn. */
  planOutcome: { episode_id: string; outcome: string } | null;
};

export async function runTurn(model: CoachModel, input: { state: SessionState; history: Turn[]; userText: string; memory: Memory; ledger: Ledger }, opts: TurnOptions): Promise<TurnResult> {
  const started = Date.now();
  const { history, userText, memory, ledger } = input;
  let state = input.state;

  // 1. Safety screen, before anything else. The keyword screen cannot be overruled.
  const kw = keywordScreen(userText);
  let modelSafety: SafetyResult | null = null;
  try {
    modelSafety = await model.safety(userText, history);
  } catch {
    modelSafety = null; // keyword screen still applies
  }
  const safety = mergeSafety(kw, modelSafety);
  const baseTrace = { safety, corrections: [] as string[], attempts: [], flags: null, model: model.name };
  if (safety.crisis) {
    const s = structuredClone(state);
    s.crisis = true;
    return { reply: crisisReply(safety.category, opts.country), state: s, trace: { ...baseTrace, extraction: null, stage: state.stage, plan: null, fallback: false, ms: Date.now() - started }, episode: null, planOutcome: null };
  }
  if (safety.wants_diagnosis) {
    return { reply: DIAGNOSIS_REPLY, state, trace: { ...baseTrace, extraction: null, stage: state.stage, plan: null, fallback: false, ms: Date.now() - started }, episode: null, planOutcome: null };
  }

  // 2. Extractor: structured facts from the message.
  const lastAssistant = [...history].reverse().find((t) => t.role === "assistant")?.text ?? null;
  const extraction = await model.extract({ userText, history, state, lastAssistant });
  state = applyExtraction(state, extraction);
  state = resolvePermission(state, userText);
  state = resolveVerdict(state, extraction);
  if (state.stage === "intake" && history.some((t) => t.role === "user")) state = { ...state, stage: "clarify" };

  let planOutcome: TurnResult["planOutcome"] = null;
  if (memory.openPlan && extraction.plan_outcome !== "none") planOutcome = { episode_id: memory.openPlan.episode_id, outcome: extraction.plan_outcome };

  // A new topic after a finished investigation starts a fresh one.
  if ((state.stage === "closed" || state.stage === "record") && extraction.event && extraction.event !== input.state.slots.event && !extraction.wants_to_end) {
    const fresh = { ...state, stage: "intake" as Stage, stage_turns: 0, hypotheses: [], pending_insight: null, coaching: null, recorded_episode_id: null };
    fresh.slots = { ...state.slots, event: extraction.event, feelings: extraction.feelings, interpretation: extraction.interpretation, action_taken: extraction.action_taken, thinking_traps: extraction.thinking_traps, people: extraction.people, context: extraction.context };
    state = fresh;
  }

  const stage = stageForTurn(state);
  const { cards, policy } = { cards: cardsFor(stage, state, userText, { firstSession: opts.firstSession, hasOpenPlan: !!memory.openPlan }), policy: loadKnowledge().policy };

  // 3. Analyst: hypotheses and the next move. Code decides what is allowed.
  const directives = directivesFor(stage, state, memory, opts);
  let enforced = await planTurn(model, { stage, state, history, userText, extraction, memory, cards, policy, ledger, directives, deeperChainAnalysis: opts.deeperChainAnalysis });
  const corrections = [...enforced.corrections];

  // 4. Voice + critic loop.
  const recentlyUsed = [...new Set(ledger.replies.slice(-30).map(openerOf).filter(Boolean))];
  const examples = examplesFor(enforced.plan.principle_ids).map((conv) => conv.map((t) => ({ role: t.role, text: t.text })));
  const attempts: { draft: string; problems: string[] }[] = [];
  let reply: string | null = null;
  let flags: RuleResult["flags"] | null = null;
  let feedback: string[] = [];
  for (let round = 0; round < 2 && reply === null; round++) {
    for (let i = 0; i <= MAX_REWRITES && reply === null; i++) {
      const draft = (await model.voice({ stage, plan: enforced.plan, history, userText, memory, recentlyUsed, feedback, voiceMode: !!opts.voiceMode, examples })).trim();
      const rules = checkDraft(draft, { stage, plan: enforced.plan, userText, recentReplies: ledger.replies, voiceMode: opts.voiceMode });
      flags = rules.flags;
      let problems = rules.problems;
      if (rules.pass && opts.fullPipeline) {
        const verdict = await model.critique({ draft, plan: enforced.plan, stage, history, userText, state }).catch(() => null);
        if (verdict && !verdict.pass) problems = verdict.problems;
      }
      attempts.push({ draft, problems });
      if (problems.length === 0) reply = draft;
      else feedback = problems;
    }
    if (reply === null && round === 0) {
      // Plan-level problems: send back to the analyst once with the critic's notes.
      enforced = await planTurn(model, { stage, state, history, userText, extraction, memory, cards, policy, ledger, directives: [...directives, `The last plan produced replies the critic rejected: ${feedback.join("; ")}. Re-plan.`], deeperChainAnalysis: opts.deeperChainAnalysis });
      corrections.push(...enforced.corrections, "re-planned after critic rejections");
    }
  }
  const fallback = reply === null;
  if (reply === null) reply = fallbackReply(stage, enforced.plan);

  // 5. Advance the state; record the episode when coaching is done.
  let next = afterReply(state, stage, enforced.plan);
  let episode: Episode | null = null;
  if (next.stage === "record" && !next.recorded_episode_id) {
    episode = buildEpisode(next, opts.now ?? new Date());
    next = { ...next, recorded_episode_id: episode.episode_id, stage: "closed", stage_turns: 0 };
  }

  return {
    reply,
    state: next,
    trace: { safety, extraction, stage, plan: enforced.plan, corrections, attempts, flags, fallback, model: model.name, ms: Date.now() - started },
    episode,
    planOutcome,
  };
}

async function planTurn(model: CoachModel, input: Parameters<CoachModel["analyse"]>[0]) {
  const proposed = await model.analyse(input);
  return enforcePlan(input.stage, input.state, proposed);
}

/** Plain-language instructions from the state machine to the analyst. */
export function directivesFor(stage: Stage, state: SessionState, memory: Memory, opts: TurnOptions): string[] {
  const d: string[] = [`Current stage: ${stage}. Allowed moves: ${ALLOWED_MOVES[stage].join(", ")}.`];
  if (stage === "clarify") {
    const missing = missingSlots(state.slots);
    d.push(`Still missing: ${missing.join(", ") || "nothing"}. Ask for the first missing one, one question only.`);
    if (state.vague_words_seen.length && missing.includes("feeling")) d.push(`The user said "${state.vague_words_seen.join('", "')}". Offer 2–3 precise feeling words that fit what they described.`);
  }
  if (stage === "hypothesise") d.push("Generate 2–4 competing explanations, each tied to a method, with what would support or rule it out. Then ask the single question that best separates the top two.");
  if (stage === "discriminate") {
    const l = leader(state.hypotheses);
    d.push(l ? `Hypothesis ${l.id} now leads.` : "No hypothesis clearly leads yet. Update the weights from the answer and ask the next most discriminating question.");
    if (state.stage_turns >= 3) d.push("Several questions already. Offer the top two as a direct choice instead of digging further.");
  }
  if (stage === "offer_insight") d.push("Offer the leading hypothesis as a possibility, with the reason from the user's own words, and end with 'does that fit?'. Summarise briefly first: this is a turning point.");
  if (stage === "confirm") d.push("The user hasn't clearly confirmed or rejected the insight. Ask once more, plainly.");
  if (stage === "coach") d.push("Give one or two concrete steps matched to the confirmed cause and an if-then plan the user can word their own way. End the session warmly but without dependency.");
  if (state.rejected_count > 0 && stage === "hypothesise") d.push("The user rejected the last insight. Take that seriously: do not re-offer it; look for what it missed.");
  if (state.reflective_streak >= 2) d.push("Two reflective turns in a row: contribute something of your own this time (an observation, a challenge or an experiment).");
  if (state.permission === "granted") d.push("The user agreed to hear your observation. State it now, kindly and plainly, using their own words.");
  if (state.permission === "declined") d.push("The user declined to hear the observation. Respect it and continue the investigation.");
  if (memory.openPlan && stage !== "coach" && state.stage_turns === 0 && state.followed_up_plan_id === null) d.push(`Open plan from last time: "${memory.openPlan.if_then}". If the user hasn't mentioned it, ask how it went.`);
  if (memory.offLimits.length || state.off_limits.length) d.push(`Off-limits topics: ${[...memory.offLimits, ...state.off_limits].join(", ")}. Don't raise them.`);
  if (memory.failedStrategies.length) d.push(`Strategies that didn't help before (never re-offer): ${memory.failedStrategies.join("; ")}.`);
  if (opts.firstSession) d.push("This is the user's first session: aim for a named feeling, one confirmed insight and one if-then plan.");
  return d;
}

/** Used only when every draft failed the critic: short, rule-safe, and still on task. */
export function fallbackReply(stage: Stage, plan: AnalystPlan): string {
  if (plan.insight) return `Here's one possibility: ${lowerFirst(plan.insight.statement)} Does that fit?`;
  if (plan.coaching) return `One thing to try: ${lowerFirst(plan.coaching.steps[0])}${plan.coaching.if_then ? ` Put simply: ${plan.coaching.if_then}` : ""}`;
  if (plan.question) return plan.question;
  if (stage === "clarify") return "What happened just before you started feeling this way?";
  return "What feels most important to look at next?";
}

export function buildEpisode(state: SessionState, now: Date): Episode {
  const s = state.slots;
  return {
    episode_id: `ep_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: now.toISOString().slice(0, 10),
    event: s.event ?? "Unspecified event",
    people: s.people,
    context: s.context,
    feelings: s.feelings,
    interpretation: s.interpretation,
    thinking_traps: s.thinking_traps,
    hypotheses: state.hypotheses.map((h) => ({ cause: h.cause, confidence: h.confidence })),
    action_taken: s.action_taken,
    strategy_offered: state.coaching ? [...state.coaching.steps, state.coaching.if_then].filter(Boolean).join(" ") : null,
    strategy_outcome: null,
  };
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1).replace(/[.?!]\s*$/, "") + "." : s);
