import { z } from "zod";

/**
 * Every shape that crosses a boundary (model output, database row, API body)
 * is defined here once, so the pipeline, the store and the eval suite agree.
 */

export const STAGES = [
  "intake",
  "clarify",
  "hypothesise",
  "discriminate",
  "offer_insight",
  "confirm",
  "coach",
  "record",
  "closed",
] as const;
export type Stage = (typeof STAGES)[number];

export const CONFIDENCE = ["unconfirmed", "likely", "user_confirmed", "user_rejected"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const THINKING_TRAPS = [
  "mind_reading",
  "catastrophising",
  "all_or_nothing",
  "overgeneralising",
  "personalising",
  "should_statements",
  "emotional_reasoning",
  "labelling",
  "discounting_positives",
] as const;
export type ThinkingTrap = (typeof THINKING_TRAPS)[number];

/** The method each hypothesis is tied to (spec: "Methods to build on"). */
export const METHODS = ["appraisal", "cbt_chain", "thinking_trap", "needs", "chain_analysis"] as const;

/** Conversational moves, tracked for strategy rotation (spec: "Anti-repetition system"). */
export const MOVES = [
  "question",
  "reflection",
  "observation",
  "challenge",
  "reframe",
  "encouragement",
  "plan",
  "insight",
  "follow_up",
  "safety",
] as const;
export type Move = (typeof MOVES)[number];

export const Feeling = z.object({
  label: z.string().min(1),
  intensity: z.number().int().min(1).max(10).nullable(),
});
export type Feeling = z.infer<typeof Feeling>;

export const Hypothesis = z.object({
  id: z.string(),
  cause: z.string().min(1),
  method: z.enum(METHODS),
  /** 0..1, the analyst's current weight. Code, not the model, decides when this is enough. */
  weight: z.number().min(0).max(1),
  supports: z.string(),
  rules_out: z.string(),
  confidence: z.enum(CONFIDENCE),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

/** The required slots the clarify stage must fill before hypotheses are generated. */
export const Slots = z.object({
  event: z.string().nullable(),
  feelings: z.array(Feeling),
  interpretation: z.string().nullable(),
  action_taken: z.string().nullable(),
  people: z.array(z.string()),
  context: z.array(z.string()),
  thinking_traps: z.array(z.enum(THINKING_TRAPS)),
  background_stress: z.string().nullable(),
});
export type Slots = z.infer<typeof Slots>;

export const emptySlots = (): Slots => ({
  event: null,
  feelings: [],
  interpretation: null,
  action_taken: null,
  people: [],
  context: [],
  thinking_traps: [],
  background_stress: null,
});

/** Structured episode record (spec: "Structured episode record"). */
export const Episode = z.object({
  episode_id: z.string(),
  date: z.string(),
  event: z.string(),
  people: z.array(z.string()),
  context: z.array(z.string()),
  feelings: z.array(Feeling),
  interpretation: z.string().nullable(),
  thinking_traps: z.array(z.enum(THINKING_TRAPS)),
  hypotheses: z.array(z.object({ cause: z.string(), confidence: z.enum(CONFIDENCE) })),
  action_taken: z.string().nullable(),
  strategy_offered: z.string().nullable(),
  strategy_outcome: z.string().nullable(),
});
export type Episode = z.infer<typeof Episode>;

// ─── Model call outputs ────────────────────────────────────────────────────

export const SafetyResult = z.object({
  crisis: z.boolean(),
  category: z.enum(["none", "self_harm", "suicide", "abuse", "harm_to_others", "medical_emergency"]),
  /** Not a crisis, but the user asked for a diagnosis or medical advice. */
  wants_diagnosis: z.boolean(),
  reason: z.string(),
});
export type SafetyResult = z.infer<typeof SafetyResult>;

export const ExtractorOutput = z.object({
  event: z.string().nullable(),
  feelings: z.array(Feeling),
  /** Words like "bad", "stressed", "off" the user used instead of a precise feeling. */
  vague_feeling_words: z.array(z.string()),
  interpretation: z.string().nullable(),
  action_taken: z.string().nullable(),
  people: z.array(z.string()),
  context: z.array(z.string()),
  thinking_traps: z.array(z.enum(THINKING_TRAPS)),
  background_stress: z.string().nullable(),
  /** The user's response to an insight or pattern that was put to them. */
  verdict: z.enum(["none", "confirm", "partly", "reject"]),
  /** Correction or reworded cause when the user said "partly" or "that's not it". */
  correction: z.string().nullable(),
  /** Topics the user said they don't want to talk about. */
  off_limits: z.array(z.string()),
  /** Short phrases in the user's own words worth remembering ("the Sunday dread"). */
  memorable_phrases: z.array(z.string()),
  /** Outcome of the last if-then plan, if the user reported one. */
  plan_outcome: z.enum(["none", "tried_helped", "tried_mixed", "tried_didnt_help", "not_tried"]),
  wants_to_end: z.boolean(),
});
export type ExtractorOutput = z.infer<typeof ExtractorOutput>;

export const AnalystPlan = z.object({
  hypotheses: z.array(Hypothesis).max(4),
  move: z.enum(MOVES),
  /** What the reply must accomplish, in one or two sentences, for the voice writer. */
  intent: z.string(),
  /** The single question to ask, if any. */
  question: z.string().nullable(),
  /** The hypothesis the question is meant to test, so the answer can be scored against it. */
  probe_hypothesis_id: z.string().nullable(),
  /** When offering an insight: the cause, phrased as a possibility, and the evidence. */
  insight: z.object({ hypothesis_id: z.string(), statement: z.string(), evidence: z.string() }).nullable(),
  /** One or two concrete steps, with the if-then plan when coaching. */
  coaching: z
    .object({ steps: z.array(z.string()).min(1).max(2), if_then: z.string().nullable() })
    .nullable(),
  /** IDs of past episodes or patterns this turn draws on ("this sounds like..."). */
  references: z.array(z.string()),
  /** Principle-card IDs applied this turn (logged; used by the eval suite). */
  principle_ids: z.array(z.string()),
  /** True if the plan includes an uncomfortable observation (ask permission first). */
  hard_observation: z.boolean(),
});
export type AnalystPlan = z.infer<typeof AnalystPlan>;

export const CriticVerdict = z.object({
  pass: z.boolean(),
  problems: z.array(z.string()),
});
export type CriticVerdict = z.infer<typeof CriticVerdict>;

// ─── Session state (persisted between turns) ───────────────────────────────

export const SessionState = z.object({
  stage: z.enum(STAGES),
  slots: Slots,
  hypotheses: z.array(Hypothesis),
  /** Turns spent in the current stage, so a stuck stage can move on gently. */
  stage_turns: z.number().int(),
  /** Consecutive purely reflective turns (spec: no more than two in a row). */
  reflective_streak: z.number().int(),
  /** The insight currently put to the user, awaiting confirm/reject. */
  pending_insight: z.object({ hypothesis_id: z.string(), statement: z.string() }).nullable(),
  rejected_count: z.number().int(),
  hard_observations: z.number().int(),
  /** Permission asked and granted for a hard observation this session. */
  permission: z.enum(["none", "asked", "granted", "declined"]),
  coaching: z.object({ steps: z.array(z.string()), if_then: z.string().nullable() }).nullable(),
  off_limits: z.array(z.string()),
  memorable_phrases: z.array(z.string()),
  vague_words_seen: z.array(z.string()),
  crisis: z.boolean(),
  /** The previous plan this session opened by following up on. */
  followed_up_plan_id: z.string().nullable(),
  recorded_episode_id: z.string().nullable(),
  /** The hypothesis the last question tested. */
  last_probe: z.string().nullable(),
});
export type SessionState = z.infer<typeof SessionState>;

export const newSessionState = (): SessionState => ({
  stage: "intake",
  slots: emptySlots(),
  hypotheses: [],
  stage_turns: 0,
  reflective_streak: 0,
  pending_insight: null,
  rejected_count: 0,
  hard_observations: 0,
  permission: "none",
  coaching: null,
  off_limits: [],
  memorable_phrases: [],
  vague_words_seen: [],
  crisis: false,
  followed_up_plan_id: null,
  recorded_episode_id: null,
  last_probe: null,
});
