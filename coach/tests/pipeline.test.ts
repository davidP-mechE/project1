import { describe, expect, it } from "vitest";
import { runTurn } from "@/engine/pipeline";
import { OfflineCoachModel } from "@/engine/offline-model";
import { newSessionState } from "@/engine/schema";
import { emptyMemory, type CoachModel, type Turn } from "@/engine/model";
import { loadScenarios, runScenario, ScriptedUser } from "@/evals/harness";

const opts = { fullPipeline: true, deeperChainAnalysis: false };

describe("turn pipeline", () => {
  it("runs the friend scenario from the spec to a confirmed insight, a plan and an episode", async () => {
    const s = loadScenarios().find((x) => x.id === "friend_plans_instagram")!;
    const r = await runScenario(new OfflineCoachModel(), s, new ScriptedUser());
    expect(r.confirmed).toBe(true);
    expect(r.coached).toBe(true);
    expect(r.prematureInsights).toBe(0);
    expect(r.replies.at(-1)).toMatch(/\bIf\b.*\bthen\b/);
  });

  it("stops coaching and shows help on a crisis, before any other model call", async () => {
    let calls = 0;
    const m = new OfflineCoachModel();
    const spy: CoachModel = { name: "spy", safety: () => m.safety(), extract: async (i) => (calls++, m.extract(i)), analyse: async (i) => (calls++, m.analyse(i)), voice: async (i) => (calls++, m.voice(i)), critique: () => m.critique() };
    const r = await runTurn(spy, { state: newSessionState(), history: [], userText: "Everyone would be better off without me.", memory: emptyMemory(), ledger: { replies: [], moves: [], strategies: [] } }, { ...opts, country: "US" });
    expect(r.trace.safety.crisis).toBe(true);
    expect(r.reply).toContain("988");
    expect(calls).toBe(0);
    expect(r.state.crisis).toBe(true);
  });

  it("won't diagnose", async () => {
    const r = await runTurn(new OfflineCoachModel(), { state: newSessionState(), history: [], userText: "Do I have anxiety?", memory: emptyMemory(), ledger: { replies: [], moves: [], strategies: [] } }, opts);
    expect(r.reply).toMatch(/can't tell you whether you have a condition/);
  });

  it("uses a rule-safe fallback when every draft fails the critic", async () => {
    const m = new OfflineCoachModel();
    const bad: CoachModel = { ...m, name: "bad", safety: () => m.safety(), extract: (i) => m.extract(i), analyse: (i) => m.analyse(i), critique: () => m.critique(), voice: async () => "It sounds like you have anxiety. Why? How?" };
    const history: Turn[] = [];
    const r = await runTurn(bad, { state: newSessionState(), history, userText: "I feel off today", memory: emptyMemory(), ledger: { replies: [], moves: [], strategies: [] } }, opts);
    expect(r.trace.fallback).toBe(true);
    expect(r.reply).not.toMatch(/anxiety|sounds like/i);
  });

  it("follows up on the last plan and records the outcome", async () => {
    const memory = { ...emptyMemory(), openPlan: { episode_id: "ep_1", if_then: "If plans change, then I'll ask Jordan.", event: "plans", people: ["friend:Jordan"] } };
    const history: Turn[] = [{ role: "assistant", text: "Before anything else: did you end up talking to Jordan? Last time the plan was if plans change, you'd ask Jordan." }];
    const r = await runTurn(new OfflineCoachModel(), { state: newSessionState(), history, userText: "I did, and it helped a lot actually.", memory, ledger: { replies: [], moves: [], strategies: [] } }, opts);
    expect(r.planOutcome).toEqual({ episode_id: "ep_1", outcome: "tried_helped" });
    expect(r.reply).toMatch(/helped/);
  });
});
