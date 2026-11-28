import type { AnalystPlan, ExtractorOutput, Hypothesis, Move, SessionState, Slots, Stage } from "./schema";
import { precisionOf } from "./emotions";

/**
 * The investigation state machine (spec: "The investigation state machine").
 *
 * The model proposes; this file decides. It tracks the stage, refuses to let a
 * plan skip ahead (no insight before the slots are filled and one hypothesis
 * clearly leads, no coaching before a cause is confirmed), and sends a rejected
 * insight back to hypothesising, never forward.
 */

/** A hypothesis "clearly leads" when it is this heavy and this far ahead of the next. */
export const LEAD_WEIGHT = 0.6;
export const LEAD_MARGIN = 0.2;
/** After this many clarify turns with an event and a feeling, move on rather than interrogate. */
export const MAX_CLARIFY_TURNS = 4;
/** After this many discriminating questions with no leader, offer the top two as a choice. */
export const MAX_DISCRIMINATE_TURNS = 3;
/** Spec: "no more than two purely reflective turns in a row". */
export const MAX_REFLECTIVE_STREAK = 2;

export type SlotName = "event" | "feeling" | "interpretation" | "action_taken";

/** Required slots for the clarify stage, in the order they are usually asked. */
export function missingSlots(slots: Slots): SlotName[] {
  const missing: SlotName[] = [];
  if (!slots.event) missing.push("event");
  if (!slots.feelings.some((f) => precisionOf(f.label) >= 1)) missing.push("feeling");
  if (!slots.interpretation) missing.push("interpretation");
  if (!slots.action_taken) missing.push("action_taken");
  return missing;
}

export function rankHypotheses(hs: Hypothesis[]): Hypothesis[] {
  return hs.filter((h) => h.confidence !== "user_rejected").sort((a, b) => b.weight - a.weight);
}

export function leader(hs: Hypothesis[]): Hypothesis | null {
  const [top, next] = rankHypotheses(hs);
  if (!top) return null;
  if (top.weight >= LEAD_WEIGHT && top.weight - (next?.weight ?? 0) >= LEAD_MARGIN) return top;
  return null;
}

/** Merge newly extracted facts into the session; new values fill gaps, never erase. */
export function applyExtraction(state: SessionState, x: ExtractorOutput): SessionState {
  const s = structuredClone(state);
  const slots = s.slots;
  slots.event = slots.event ?? x.event;
  // The interpretation can be refined while clarifying, but not overwritten later by an answer to something else.
  slots.interpretation = state.stage === "intake" || state.stage === "clarify" ? x.interpretation ?? slots.interpretation : slots.interpretation ?? x.interpretation;
  slots.action_taken = slots.action_taken ?? x.action_taken;
  slots.background_stress = slots.background_stress ?? x.background_stress;
  for (const f of x.feelings) {
    const existing = slots.feelings.find((e) => e.label.toLowerCase() === f.label.toLowerCase());
    if (existing) existing.intensity = f.intensity ?? existing.intensity;
    else slots.feelings.push({ label: f.label.toLowerCase(), intensity: f.intensity });
  }
  slots.people = mergePeople(slots.people, x.people);
  slots.context = uniq([...slots.context, ...x.context]);
  slots.thinking_traps = uniq([...slots.thinking_traps, ...x.thinking_traps]);
  s.off_limits = uniq([...s.off_limits, ...x.off_limits]);
  s.memorable_phrases = uniq([...s.memorable_phrases, ...x.memorable_phrases]).slice(-12);
  s.vague_words_seen = uniq([...s.vague_words_seen, ...x.vague_feeling_words]);
  return s;
}

/**
 * Resolve the user's answer to a pending insight. Confirm → coach. Reject →
 * back to hypothesise (step 6: "A rejection sends the engine back to step 3,
 * never forward"). No clear verdict → ask once more, then keep investigating.
 */
export function resolveVerdict(state: SessionState, x: ExtractorOutput): SessionState {
  if (state.stage !== "confirm" || !state.pending_insight) return state;
  const s = structuredClone(state);
  const id = s.pending_insight!.hypothesis_id;
  const h = s.hypotheses.find((h) => h.id === id);
  if (x.verdict === "confirm" || x.verdict === "partly") {
    if (h) {
      h.confidence = "user_confirmed";
      h.weight = 1;
      if (x.verdict === "partly" && x.correction) h.cause = x.correction;
    }
    s.pending_insight = null;
    return enter(s, "coach");
  }
  if (x.verdict === "reject") {
    if (h) {
      h.confidence = "user_rejected";
      h.weight = 0;
    }
    if (x.correction) {
      // The user named the real cause. It becomes a hypothesis to test, not a fact: the
      // next insight still has to be put to them and confirmed.
      s.hypotheses.push({
        id: `h${s.hypotheses.length + 1}`,
        cause: x.correction,
        method: "needs",
        weight: 0.5,
        supports: "the user's own correction",
        rules_out: "",
        confidence: "likely",
      });
    }
    s.pending_insight = null;
    s.rejected_count += 1;
    return enter(s, "hypothesise");
  }
  if (s.stage_turns >= 1) {
    s.pending_insight = null;
    return enter(s, "discriminate");
  }
  return s;
}

function enter(s: SessionState, stage: Stage): SessionState {
  if (s.stage !== stage) s.stage_turns = 0;
  s.stage = stage;
  return s;
}

/** Which stage this turn works in, given everything known before the analyst runs. */
export function stageForTurn(state: SessionState): Stage {
  switch (state.stage) {
    case "intake":
    case "clarify": {
      const missing = missingSlots(state.slots);
      if (missing.length === 0) return "hypothesise";
      // Don't interrogate: after enough clarify turns, move on with what's known, as long as
      // there's an event (and a feeling, or at least an interpretation to work from).
      const hasCore = !missing.includes("event") && (!missing.includes("feeling") || !missing.includes("interpretation"));
      if (state.stage === "clarify" && hasCore && state.stage_turns >= MAX_CLARIFY_TURNS) return "hypothesise";
      return "clarify";
    }
    case "hypothesise":
      return rankHypotheses(state.hypotheses).length >= 2 ? "discriminate" : "hypothesise";
    case "discriminate":
      return leader(state.hypotheses) ? "offer_insight" : "discriminate";
    case "record":
    case "closed":
      return "closed";
    default:
      return state.stage;
  }
}

/** Moves the analyst may use in each stage. */
export const ALLOWED_MOVES: Record<Stage, Move[]> = {
  intake: ["question", "reflection", "follow_up"],
  clarify: ["question", "reflection", "observation", "follow_up"],
  hypothesise: ["question", "observation", "challenge", "reframe"],
  discriminate: ["question", "observation", "challenge", "reframe", "insight"],
  offer_insight: ["insight"],
  confirm: ["question", "insight", "observation"],
  coach: ["plan", "encouragement"],
  record: ["plan", "encouragement"],
  closed: ["question", "reflection", "encouragement", "observation", "follow_up"],
};

const REFLECTIVE: Move[] = ["reflection", "encouragement"];

export type Enforcement = { plan: AnalystPlan; corrections: string[] };

/**
 * Bring a proposed plan back inside the rules for this stage. Every correction is
 * logged: in the eval suite a correction of "insight before facts" is a premature
 * conclusion the model attempted and the code prevented.
 */
export function enforcePlan(stage: Stage, state: SessionState, proposed: AnalystPlan): Enforcement {
  const plan = structuredClone(proposed);
  const corrections: string[] = [];

  if (plan.hypotheses.length > 4) {
    plan.hypotheses = plan.hypotheses.slice(0, 4);
    corrections.push("trimmed to 4 hypotheses");
  }
  // Rejected hypotheses stay rejected; the model cannot quietly revive one.
  for (const h of plan.hypotheses) {
    const prior = state.hypotheses.find((p) => p.id === h.id || norm(p.cause) === norm(h.cause));
    if (prior?.confidence === "user_rejected") {
      h.confidence = "user_rejected";
      h.weight = 0;
    }
    if (h.confidence === "user_confirmed" && prior?.confidence !== "user_confirmed") {
      h.confidence = "likely";
      corrections.push("only the user can confirm a cause");
    }
  }

  // An insight is allowed in offer_insight, or in discriminate once the user's answer
  // to a discriminating question makes one hypothesis clearly lead (checked below).
  if (plan.insight && stage !== "offer_insight" && stage !== "confirm" && stage !== "discriminate") {
    corrections.push(`premature insight in ${stage}`);
    plan.insight = null;
    if (plan.move === "insight") plan.move = "question";
  }
  if (stage === "offer_insight" && !plan.insight) {
    const top = leader(plan.hypotheses.length ? plan.hypotheses : state.hypotheses);
    if (top) {
      plan.insight = { hypothesis_id: top.id, statement: top.cause, evidence: top.supports };
      corrections.push("insight stage without an insight: used the leading hypothesis");
    }
  }
  if (plan.insight) {
    const all = plan.hypotheses.length ? plan.hypotheses : state.hypotheses;
    const h = all.find((x) => x.id === plan.insight!.hypothesis_id);
    if (!h || leader(all)?.id !== h.id) {
      corrections.push("insight is not the clear leader");
      plan.insight = null;
      plan.move = "question";
    }
  }
  const confirmed = state.hypotheses.some((h) => h.confidence === "user_confirmed");
  if (plan.coaching && !confirmed && stage !== "coach") {
    corrections.push(`coaching before a confirmed cause (${stage})`);
    plan.coaching = null;
  }
  if (stage === "coach" && !plan.coaching) corrections.push("coach stage without coaching");

  if (!ALLOWED_MOVES[stage].includes(plan.move)) {
    corrections.push(`move ${plan.move} not allowed in ${stage}`);
    plan.move = ALLOWED_MOVES[stage][0];
  }
  if (REFLECTIVE.includes(plan.move) && state.reflective_streak >= MAX_REFLECTIVE_STREAK) {
    corrections.push("third reflective turn in a row");
    plan.move = ALLOWED_MOVES[stage].find((m) => !REFLECTIVE.includes(m)) ?? "observation";
  }
  // One uncomfortable truth per session, and only with permission.
  if (plan.hard_observation) {
    if (state.hard_observations >= 1) {
      corrections.push("second hard observation this session");
      plan.hard_observation = false;
      if (plan.move === "challenge") plan.move = "question";
    } else if (state.permission !== "granted") {
      plan.intent = `Ask permission before the observation; do not state it yet. ${plan.intent}`;
      plan.question = "Can I point out something I'm noticing?";
    }
  }
  return { plan, corrections };
}

/** Advance the state after the reply is sent. */
export function afterReply(state: SessionState, stage: Stage, plan: AnalystPlan): SessionState {
  let s = structuredClone(state);
  if (plan.hypotheses.length) s.hypotheses = mergeHypotheses(s.hypotheses, plan.hypotheses);
  s.reflective_streak = REFLECTIVE.includes(plan.move) ? s.reflective_streak + 1 : 0;
  s.last_probe = plan.question ? plan.probe_hypothesis_id : null;
  if (plan.hard_observation) {
    if (s.permission === "granted") {
      s.hard_observations += 1;
      s.permission = "none";
    } else s.permission = "asked";
  }
  const sameStage = s.stage === stage;
  s = enter(s, stage);
  s.stage_turns = sameStage ? s.stage_turns + 1 : 1;

  if (stage === "hypothesise" && rankHypotheses(s.hypotheses).length >= 2) s = enter(s, "discriminate");
  if ((stage === "offer_insight" || stage === "discriminate" || stage === "confirm") && plan.insight) {
    s.pending_insight = { hypothesis_id: plan.insight.hypothesis_id, statement: plan.insight.statement };
    s = enter(s, "confirm");
  }
  if (stage === "coach" && plan.coaching) {
    s.coaching = { steps: plan.coaching.steps, if_then: plan.coaching.if_then };
    s = enter(s, "record");
  }
  if (stage === "clarify" && s.stage === "intake") s = enter(s, "clarify");
  return s;
}

function mergeHypotheses(prior: Hypothesis[], next: Hypothesis[]): Hypothesis[] {
  const out = prior.map((p) => ({ ...p }));
  for (const h of next) {
    const i = out.findIndex((p) => p.id === h.id || norm(p.cause) === norm(h.cause));
    if (i === -1) out.push({ ...h, id: h.id || `h${out.length + 1}` });
    else if (out[i].confidence === "user_confirmed" || out[i].confidence === "user_rejected") continue;
    else out[i] = { ...out[i], ...h, id: out[i].id };
  }
  return out;
}

/** Permission answer: "yes/sure/go ahead" after asking to share an observation. */
export function resolvePermission(state: SessionState, userText: string): SessionState {
  if (state.permission !== "asked") return state;
  const s = structuredClone(state);
  const t = userText.toLowerCase();
  if (/\b(no|not now|rather not|don'?t|nah)\b/.test(t)) s.permission = "declined";
  else if (/\b(yes|yeah|yep|sure|ok|okay|go ahead|go on|please|fine)\b/.test(t)) s.permission = "granted";
  return s;
}

/**
 * "friend" then "friend:Jordan" → "friend:Jordan"; "Jordan" then "friend:Jordan" → "friend:Jordan".
 * A bare name next to a bare relation in the same story is left alone: they may be two people.
 */
export function mergePeople(prior: string[], next: string[]): string[] {
  let out = [...prior];
  for (const p of next) {
    if (out.includes(p)) continue;
    const [rel, name] = p.split(":");
    if (name) out = out.filter((o) => o !== rel && o !== name);
    else if (out.some((o) => o.split(":")[0] === p || o.split(":")[1] === p)) continue;
    out.push(p);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
