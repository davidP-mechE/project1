import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { answersMatch, BlueprintFileSchema, decide, difficultySplit, generateUserText, localProblems, planRequests, similarity, StyleSpecSchema, toImportRecord, type GeneratedItem, type Slot, type Verdict } from "@/lib/bank/generate";

const blueprints = BlueprintFileSchema.parse(JSON.parse(fs.readFileSync("data/blueprints/sat-blueprints.json", "utf8"))).blueprints;
const A1 = blueprints.find((b) => b.id === "A1")!;
const E15 = blueprints.find((b) => b.id === "E15")!;
const slot: Slot = { slot: "A1-2-001", blueprint: "A1", difficulty: 2, type: "mcq", letter: "B", topic: "x" };
const item: GeneratedItem = {
  slot: "A1-2-001",
  skill: "Linear equations in two variables",
  type: "mcq",
  stem: "A line passes through $(2, 7)$ and $(5, 16)$. What is the $y$-intercept of the line?",
  choices: ["$-1$", "$1$", "$3$", "$7$"],
  answer: "B",
  explanation: "Choice B is correct. The slope is $\\frac{16-7}{5-2}=3$, so $7 = 3(2) + b$ and $b = 1$.",
  distractor_notes: [
    { choice: "A", mistake: "sign error solving for b" },
    { choice: "C", mistake: "the slope itself" },
    { choice: "D", mistake: "a given point's y-value" },
  ],
  desmos_check: "",
  topic: "pure math",
};
const verdict: Verdict = { answer: "B", work: "", issues: [], sat_quality: 5, difficulty: 2 };

describe("blueprints", () => {
  it("are all valid, with unique ids, and add up to about 1,500 questions", () => {
    expect(new Set(blueprints.map((b) => b.id)).size).toBe(blueprints.length);
    expect(blueprints.reduce((s, b) => s + b.count, 0)).toBe(1502);
  });
  it("plan the same slots every run, with extra to allow for drops", () => {
    const a = planRequests(blueprints);
    expect(planRequests(blueprints)).toEqual(a);
    const n = a.reduce((s, q) => s + q.slots.length, 0);
    expect(n).toBeGreaterThan(1502 * 1.2);
    expect(a.every((q) => q.slots.length <= 4)).toBe(true);
    expect(new Set(a.flatMap((q) => q.slots.map((s) => s.slot))).size).toBe(n);
  });
  it("split difficulty 30/40/30", () => expect(difficultySplit(25)).toEqual({ 1: 8, 2: 9, 3: 8 }));
});

describe("keeping a question", () => {
  it("keeps a clean question the cold solve agrees with", () => expect(decide(item, A1, slot, verdict)).toEqual({ keep: true, reasons: [] }));
  it("drops it when the cold solve disagrees, a serious issue is found, or quality is low", () => {
    expect(decide(item, A1, slot, { ...verdict, answer: "C" }).keep).toBe(false);
    expect(decide(item, A1, slot, { ...verdict, issues: [{ kind: "more_than_one_defensible", detail: "C also works" }] }).keep).toBe(false);
    expect(decide(item, A1, slot, { ...verdict, sat_quality: 3 }).keep).toBe(false);
    expect(decide(item, A1, slot, null).keep).toBe(false);
  });
  it("keeps a hard question only if it plays hard", () => {
    const hard = { ...slot, difficulty: 3 as const };
    expect(decide(item, A1, hard, { ...verdict, difficulty: 2 }).keep).toBe(false);
    expect(decide(item, A1, hard, { ...verdict, difficulty: 3 }).keep).toBe(true);
    expect(decide(item, A1, { ...slot, difficulty: 1 }, { ...verdict, difficulty: 2 }).keep).toBe(true);
  });
  it("catches duplicate choices, bad LaTeX and a wrong skill", () => {
    expect(localProblems({ ...item, choices: ["1", "1", "2", "3"] }, A1).join()).toMatch(/same/);
    expect(localProblems({ ...item, stem: "What is $\\frac{1}{$?" }, A1).join()).toMatch(/render/);
    expect(localProblems({ ...item, skill: "Circles" }, A1).join()).toMatch(/Skill/);
  });
  it("matches grid-in answers by value", () => {
    const g = { ...item, type: "grid-in" as const, choices: [], answer: "7/2|3.5" };
    expect(answersMatch(g, { ...verdict, answer: "3.5" })).toBe(true);
    expect(answersMatch(g, { ...verdict, answer: "x = 7/2" })).toBe(true);
    expect(answersMatch(g, { ...verdict, answer: "4" })).toBe(false);
  });
  it("checks Reading and Writing passage length", () => {
    const short = { ...item, skill: "Words in context", stem: "Too short.\n\nWhich choice completes the text?" };
    expect(localProblems(short, E15).join()).toMatch(/words/);
  });
  it("spots near-duplicates", () => {
    expect(similarity(item.stem, item.stem.replace("(5, 16)", "(5, 17)"))).toBeGreaterThan(0.5);
    expect(similarity(item.stem, "A bakery sells muffins for three dollars each and cookies for two dollars each.")).toBeLessThan(0.2);
  });
  it("writes the bank's import format, as an original draft", () => {
    const rec = toImportRecord("GEN-A1-001", item, A1, slot, verdict);
    expect(rec).toMatchObject({ external_id: "GEN-A1-001", section: "math", type: "mcq", answer: "B", choice_b: "$1$", source: "original", status: "draft", blueprint: "A1", lesson: "M-1.2" });
  });
});

describe("style spec", () => {
  const spec = StyleSpecSchema.parse(JSON.parse(fs.readFileSync("data/blueprints/rw-style-spec.json", "utf8")));
  it("covers every Reading and Writing blueprint exactly once", () => {
    const rw = blueprints.filter((b) => b.section === "rw").map((b) => b.id).sort();
    expect(Object.values(spec.types).flatMap((t) => t.blueprints).sort()).toEqual(rw);
  });
  it("adds the targets for the requested difficulty to the request", () => {
    const text = generateUserText(E15, [{ slot: "E15-3-001", blueprint: "E15", difficulty: 3, type: "mcq", letter: "A", topic: "x" }], spec);
    expect(text).toMatch(/difficulty 3: passage 45–67 words/);
    expect(text).not.toMatch(/difficulty 1:/);
    expect(generateUserText(A1, [slot], spec)).not.toMatch(/Style targets/);
  });
});

describe("a limited run", () => {
  it("spreads the questions over every blueprint and difficulty", async () => {
    const { limitRequests } = await import("@/server/qbank-generate");
    const reqs = limitRequests(planRequests(blueprints), 141);
    const slots = reqs.flatMap((q) => q.slots);
    expect(slots).toHaveLength(141);
    expect(new Set(slots.map((s) => s.blueprint)).size).toBe(47);
    expect(new Set(slots.map((s) => s.difficulty))).toEqual(new Set([1, 2, 3]));
    expect(reqs.every((q) => q.slots.length <= 4 && q.slots.every((s) => s.blueprint === q.blueprint && s.difficulty === q.slots[0].difficulty))).toBe(true);
  });
});
