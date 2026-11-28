import { describe, expect, it } from "vitest";
import { checkDraft, countQuestions, openerOf, distinctNgrams } from "@/engine/critic-rules";
import type { AnalystPlan } from "@/engine/schema";

const plan = (p: Partial<AnalystPlan> = {}): AnalystPlan => ({ hypotheses: [], move: "question", intent: "", question: null, probe_hypothesis_id: null, insight: null, coaching: null, references: [], principle_ids: [], hard_observation: false, ...p });
const ctx = (p = plan()) => ({ stage: "clarify" as const, plan: p, userText: "My boss said my work was behind in front of everyone.", recentReplies: [] as string[] });

describe("critic rules", () => {
  it("bans stock empathy phrases", () => {
    expect(checkDraft("It sounds like that was hard. What happened next?", ctx()).flags.stockPhrase).toBe(true);
    expect(checkDraft("I hear you. What happened next?", ctx()).pass).toBe(false);
  });
  it("blocks diagnosis language", () => {
    expect(checkDraft("This sounds like anxiety. What happened next?", ctx()).flags.diagnosis).toBe(true);
    expect(checkDraft("You might have depression.", ctx()).flags.diagnosis).toBe(true);
  });
  it("flags overclaiming but not the user's quoted words", () => {
    expect(checkDraft("The real reason is that you feel unloved.", ctx()).flags.overclaim).toBe(true);
    expect(checkDraft('You said "you always do this". What happened right before?', ctx()).flags.overclaim).toBe(false);
  });
  it("one question per turn", () => {
    expect(countQuestions("What happened? And how did you feel?")).toBe(2);
    expect(checkDraft("What happened? And how did you feel?", ctx()).pass).toBe(false);
  });
  it("no bullet lists", () => {
    expect(checkDraft("Try this:\n- breathe\n- walk", ctx()).pass).toBe(false);
  });
  it("an insight must ask if it fits", () => {
    const p = plan({ move: "insight", insight: { hypothesis_id: "h1", statement: "x", evidence: "y" } });
    expect(checkDraft("Maybe it's about feeling considered.", { ...ctx(p), stage: "offer_insight" }).pass).toBe(false);
    expect(checkDraft("Maybe it's about feeling considered. Does that fit?", { ...ctx(p), stage: "offer_insight" }).pass).toBe(true);
  });
  it("rejects dependency framing and personal attacks", () => {
    expect(checkDraft("I'm always here for you. What happened?", ctx()).pass).toBe(false);
    expect(checkDraft("You're being selfish. What happened?", ctx()).pass).toBe(false);
  });
  it("rejects repeats of recent replies and reused openers", () => {
    const recent = ["Got it. What did you take it to mean when she said that?"];
    expect(checkDraft("Got it. What did you take it to mean when she said that?", { ...ctx(), recentReplies: recent }).pass).toBe(false);
    expect(openerOf("Okay, that helps. What next?")).toBe("okay");
  });
  it("matches length to the user", () => {
    const long = Array(80).fill("word").join(" ") + "?";
    expect(checkDraft(long, { ...ctx(), userText: "idk" }).pass).toBe(false);
  });
  it("scores distinct phrasing", () => {
    expect(distinctNgrams(["a b c d", "a b c d"])).toBe(0.5);
  });
});
