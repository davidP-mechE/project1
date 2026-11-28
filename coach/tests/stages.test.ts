import { describe, expect, it } from "vitest";
import { enforcePlan, stageForTurn, resolveVerdict, applyExtraction, leader, mergePeople, afterReply } from "@/engine/stages";
import { newSessionState, type AnalystPlan, type ExtractorOutput, type Hypothesis } from "@/engine/schema";

const plan = (p: Partial<AnalystPlan> = {}): AnalystPlan => ({ hypotheses: [], move: "question", intent: "", question: "What happened?", probe_hypothesis_id: null, insight: null, coaching: null, references: [], principle_ids: [], hard_observation: false, ...p });
const h = (id: string, weight: number, extra: Partial<Hypothesis> = {}): Hypothesis => ({ id, cause: `cause ${id}`, method: "needs", weight, supports: "", rules_out: "", confidence: "unconfirmed", ...extra });
const x = (p: Partial<ExtractorOutput> = {}): ExtractorOutput => ({ event: null, feelings: [], vague_feeling_words: [], interpretation: null, action_taken: null, people: [], context: [], thinking_traps: [], background_stress: null, verdict: "none", correction: null, off_limits: [], memorable_phrases: [], plan_outcome: "none", wants_to_end: false, ...p });

describe("state machine", () => {
  it("stays in clarify until the required slots are filled", () => {
    let s = applyExtraction(newSessionState(), x({ event: "Friend made plans without me", feelings: [{ label: "disappointed", intensity: 6 }] }));
    s = { ...s, stage: "clarify" };
    expect(stageForTurn(s)).toBe("clarify");
    s = applyExtraction(s, x({ interpretation: "She didn't think of me", action_taken: "Went quiet" }));
    expect(stageForTurn(s)).toBe("hypothesise");
  });

  it("strips an insight offered while still clarifying (premature conclusion)", () => {
    const s = { ...newSessionState(), stage: "clarify" as const };
    const out = enforcePlan("clarify", s, plan({ move: "insight", insight: { hypothesis_id: "h1", statement: "x", evidence: "y" }, hypotheses: [h("h1", 0.9)] }));
    expect(out.plan.insight).toBeNull();
    expect(out.corrections.join()).toMatch(/premature insight/);
  });

  it("only allows an insight for a clear leader", () => {
    const s = { ...newSessionState(), stage: "discriminate" as const };
    const close = enforcePlan("discriminate", s, plan({ move: "insight", insight: { hypothesis_id: "h1", statement: "x", evidence: "y" }, hypotheses: [h("h1", 0.6), h("h2", 0.5)] }));
    expect(close.plan.insight).toBeNull();
    const clear = enforcePlan("discriminate", s, plan({ move: "insight", insight: { hypothesis_id: "h1", statement: "x", evidence: "y" }, hypotheses: [h("h1", 0.8), h("h2", 0.3)] }));
    expect(clear.plan.insight?.hypothesis_id).toBe("h1");
  });

  it("never lets the model mark a cause as confirmed", () => {
    const s = { ...newSessionState(), stage: "discriminate" as const };
    const out = enforcePlan("discriminate", s, plan({ hypotheses: [h("h1", 0.9, { confidence: "user_confirmed" })] }));
    expect(out.plan.hypotheses[0].confidence).toBe("likely");
  });

  it("blocks coaching before a confirmed cause", () => {
    const s = { ...newSessionState(), stage: "discriminate" as const };
    const out = enforcePlan("discriminate", s, plan({ coaching: { steps: ["Do a thing"], if_then: "If x, then y" } }));
    expect(out.plan.coaching).toBeNull();
  });

  it("sends a rejection back to hypothesise, never forward", () => {
    const s = { ...newSessionState(), stage: "confirm" as const, hypotheses: [h("h1", 0.8)], pending_insight: { hypothesis_id: "h1", statement: "x" } };
    const next = resolveVerdict(s, x({ verdict: "reject" }));
    expect(next.stage).toBe("hypothesise");
    expect(next.hypotheses[0].confidence).toBe("user_rejected");
    expect(leader(next.hypotheses)).toBeNull();
  });

  it("confirm moves to coach and records the confirmation", () => {
    const s = { ...newSessionState(), stage: "confirm" as const, hypotheses: [h("h1", 0.8)], pending_insight: { hypothesis_id: "h1", statement: "x" } };
    const next = resolveVerdict(s, x({ verdict: "confirm" }));
    expect(next.stage).toBe("coach");
    expect(next.hypotheses[0].confidence).toBe("user_confirmed");
  });

  it("a rejected hypothesis can't be revived by the model", () => {
    const s = { ...newSessionState(), stage: "hypothesise" as const, hypotheses: [h("h1", 0, { confidence: "user_rejected" })] };
    const out = enforcePlan("hypothesise", s, plan({ hypotheses: [h("h1", 0.9)] }));
    expect(out.plan.hypotheses[0].confidence).toBe("user_rejected");
  });

  it("asks permission before a hard observation, and allows one per session", () => {
    const s = newSessionState();
    const first = enforcePlan("discriminate", { ...s, stage: "discriminate" }, plan({ move: "challenge", hard_observation: true }));
    expect(first.plan.question).toMatch(/Can I point out/);
    const after = afterReply({ ...s, stage: "discriminate", permission: "granted" }, "discriminate", plan({ move: "challenge", hard_observation: true }));
    const second = enforcePlan("discriminate", after, plan({ move: "challenge", hard_observation: true }));
    expect(second.plan.hard_observation).toBe(false);
  });

  it("limits purely reflective turns to two in a row", () => {
    const s = { ...newSessionState(), stage: "clarify" as const, reflective_streak: 2 };
    expect(enforcePlan("clarify", s, plan({ move: "reflection" })).plan.move).not.toBe("reflection");
  });

  it("merges people mentioned across messages", () => {
    expect(mergePeople(["friend"], ["friend:Jordan"])).toEqual(["friend:Jordan"]);
    expect(mergePeople(["Jordan"], ["friend:Jordan"])).toEqual(["friend:Jordan"]);
    expect(mergePeople(["friend:Jordan"], ["friend"])).toEqual(["friend:Jordan"]);
  });
});
