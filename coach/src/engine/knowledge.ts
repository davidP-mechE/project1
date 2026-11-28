import fs from "node:fs";
import path from "node:path";
import type { SessionState, Stage } from "./schema";

/**
 * The research layers (spec: "Packaging research for the model"): principle
 * cards, the short system policy and labelled example conversations, all
 * versioned in knowledge/. The analyst gets the cards relevant to this turn.
 */

export type PrincipleCard = {
  id: string;
  principle: string;
  evidence: string;
  strength: "strong" | "moderate" | "emerging";
  when_to_use: string;
  bot_behavior: string;
  do_example: string;
  dont_example: string;
  contraindications: string;
  source_url: string;
  stages: Stage[];
};

export type ExampleTurn = { conversation: string; turn: number; role: "user" | "assistant"; text: string; strategy?: string; principle_ids?: string[] };

const ROOT = process.env.COACH_KNOWLEDGE_DIR ?? path.join(process.cwd(), "knowledge");

let cache: { cards: PrincipleCard[]; policy: string; examples: ExampleTurn[] } | null = null;

export function loadKnowledge() {
  if (cache) return cache;
  const dir = path.join(ROOT, "cards");
  const cards = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PrincipleCard);
  const policy = fs.readFileSync(path.join(ROOT, "policy.md"), "utf8");
  const examples = fs
    .readFileSync(path.join(ROOT, "examples.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ExampleTurn);
  cache = { cards, policy, examples };
  return cache;
}

const STRENGTH_RANK = { strong: 0, moderate: 1, emerging: 2 } as const;

/** Cards for this turn: by stage, plus situational triggers. Strongest evidence first. */
export function cardsFor(stage: Stage, state: SessionState, userText: string, opts: { firstSession?: boolean; hasOpenPlan?: boolean } = {}): PrincipleCard[] {
  const { cards } = loadKnowledge();
  const want = new Set<string>();
  for (const c of cards) if (c.stages.includes(stage)) want.add(c.id);
  const t = userText.toLowerCase();
  if (state.vague_words_seen.length) want.add("precise_labels");
  if (/\bwhy (do|does|am|is|can't)\b.*\b(always|never|me)\b/.test(t)) want.add("concrete_processing");
  if (/\b(no|not really|that's not|you're wrong|i don'?t think so)\b/.test(t)) want.add("anti_sycophancy");
  if (/\b(always|never|everyone|no one|nobody)\b/.test(t)) want.add("cbt_chain");
  if (opts.firstSession) want.add("first_session_win");
  if (opts.hasOpenPlan && stage === "intake") want.add("follow_up_plans");
  return cards
    .filter((c) => want.has(c.id))
    .sort((a, b) => STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength])
    .slice(0, 6);
}

export function cardText(c: PrincipleCard): string {
  return `[${c.id}] (${c.strength}) ${c.principle}. Do: "${c.do_example}"${c.dont_example ? ` Don't: "${c.dont_example}"` : ""}`;
}

/** A few example exchanges to show tone (few-shot), chosen by strategy relevance. */
export function examplesFor(principleIds: string[], limit = 4): ExampleTurn[][] {
  const { examples } = loadKnowledge();
  const byConv = new Map<string, ExampleTurn[]>();
  for (const e of examples) byConv.set(e.conversation, [...(byConv.get(e.conversation) ?? []), e]);
  const scored = [...byConv.values()].map((turns) => ({ turns, score: turns.filter((t) => t.principle_ids?.some((p) => principleIds.includes(p))).length }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.turns.slice(0, 6));
}
