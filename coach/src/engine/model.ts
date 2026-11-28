import type { AnalystPlan, CriticVerdict, Episode, ExtractorOutput, Move, SafetyResult, SessionState, Stage } from "./schema";
import type { PrincipleCard } from "./knowledge";

/**
 * One internal interface for every model call, so models can be swapped after
 * passing the eval suite (spec: "Keep the pipeline model-agnostic"). Each call
 * has one job; no call both decides and speaks.
 */

export type Turn = { role: "user" | "assistant"; text: string };

export type Memory = {
  /** The 3–5 most similar past episodes (paid), or from the last 3 sessions (free). */
  episodes: Episode[];
  /** Confirmed patterns, as the user agreed to them. */
  patterns: { id: string; theme: string; evidence: string }[];
  /** The last if-then plan that has no outcome yet. */
  openPlan: { episode_id: string; if_then: string; event: string; people: string[] } | null;
  /** Exact phrases the user used before ("the Sunday dread"), with when. */
  phrases: { phrase: string; when: string }[];
  /** Strategies that didn't help: never re-offer. */
  failedStrategies: string[];
  /** Topics the user asked not to raise. */
  offLimits: string[];
};

export const emptyMemory = (): Memory => ({ episodes: [], patterns: [], openPlan: null, phrases: [], failedStrategies: [], offLimits: [] });

export type Ledger = {
  /** Last ~30 bot turns for this user, oldest first. */
  replies: string[];
  moves: Move[];
  strategies: string[];
};

export type ExtractInput = { userText: string; history: Turn[]; state: SessionState; lastAssistant: string | null };

export type AnalystInput = {
  stage: Stage;
  state: SessionState;
  history: Turn[];
  userText: string;
  extraction: ExtractorOutput;
  memory: Memory;
  cards: PrincipleCard[];
  policy: string;
  ledger: Ledger;
  /** Instructions from code: missing slots, allowed moves, critic feedback. */
  directives: string[];
  deeperChainAnalysis: boolean;
};

export type VoiceInput = {
  stage: Stage;
  plan: AnalystPlan;
  history: Turn[];
  userText: string;
  memory: Memory;
  /** Openers, phrases and metaphors used recently: forbidden. */
  recentlyUsed: string[];
  /** Problems from the critic on the previous draft. */
  feedback: string[];
  voiceMode: boolean;
  examples: Turn[][];
};

export type CriticInput = { draft: string; plan: AnalystPlan; stage: Stage; history: Turn[]; userText: string; state: SessionState };

export interface CoachModel {
  readonly name: string;
  /** Model safety classifier. Return null to rely on the keyword screen alone. */
  safety(userText: string, history: Turn[]): Promise<SafetyResult | null>;
  extract(input: ExtractInput): Promise<ExtractorOutput>;
  analyse(input: AnalystInput): Promise<AnalystPlan>;
  voice(input: VoiceInput): Promise<string>;
  /** Model critic. Return null to rely on the deterministic checks alone. */
  critique(input: CriticInput): Promise<CriticVerdict | null>;
}
