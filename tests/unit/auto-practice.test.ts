import { describe, expect, it } from "vitest";
import { AUTO_MIN, pickAutoSet, swapFor, weakSkills, weekOf, type PoolQuestion } from "@/lib/practice/auto";

const pool = (skill: string, n: number, from = 0): PoolQuestion[] => Array.from({ length: n }, (_, i) => ({ id: `${skill}-${from + i}`, skillId: skill, difficulty: 1 + ((from + i) % 3) }));

describe("weekly auto practice: picking questions", () => {
  it("ranks weak skills by misses and the share wrong", () => {
    const w = weakSkills([
      { skillId: "a", misses: 0, answered: 10, correct: 9 },
      { skillId: "b", misses: 3, answered: 0, correct: 0 },
      { skillId: "c", misses: 0, answered: 10, correct: 4 },
      { skillId: "d", misses: 0, answered: 2, correct: 0 }, // too few answers, no misses
      { skillId: "e", misses: 0, answered: 5, correct: 5 },
    ]);
    expect(w.map((x) => x.skillId)).toEqual(["b", "c", "a"]);
  });

  it("splits 4 / 3 / 3 over the three weakest skills, unseen and easier first", () => {
    const r = pickAutoSet({
      stats: [
        { skillId: "x", misses: 5, answered: 0, correct: 0 },
        { skillId: "y", misses: 3, answered: 0, correct: 0 },
        { skillId: "z", misses: 1, answered: 0, correct: 0 },
        { skillId: "q", misses: 0, answered: 0, correct: 0 },
      ],
      pool: [...pool("x", 6), ...pool("y", 6), ...pool("z", 6), ...pool("q", 6)],
      exclude: new Set(),
      seen: new Set(["x-0"]),
      seed: "s1",
    });
    if (!("reason" in r)) {
      expect(r.questionIds).toHaveLength(10);
      expect(r.questionIds.filter((id) => id.startsWith("x"))).toHaveLength(4);
      expect(r.questionIds.filter((id) => id.startsWith("y"))).toHaveLength(3);
      expect(r.questionIds.filter((id) => id.startsWith("z"))).toHaveLength(3);
      expect(r.questionIds).not.toContain("x-0"); // seen goes last, and 5 unseen x questions exist
      expect(r.skillIds).toEqual(["x", "y", "z"]);
    } else throw new Error(r.reason);
  });

  it("leaves out recently-correct questions and passes a short skill's places on", () => {
    const r = pickAutoSet({
      stats: [
        { skillId: "x", misses: 5, answered: 0, correct: 0 },
        { skillId: "y", misses: 3, answered: 0, correct: 0 },
      ],
      pool: [...pool("x", 3), ...pool("y", 12)],
      exclude: new Set(["x-1"]),
      seen: new Set(),
      seed: "s",
    });
    if ("reason" in r) throw new Error(r.reason);
    expect(r.questionIds).not.toContain("x-1");
    expect(r.questionIds.filter((id) => id.startsWith("x"))).toEqual(["x-0", "x-2"]);
    expect(r.questionIds).toHaveLength(10);
  });

  it("skips a student with no data, or too few questions", () => {
    expect(pickAutoSet({ stats: [], pool: pool("x", 20), exclude: new Set(), seen: new Set(), seed: "s" })).toMatchObject({ reason: /No practice data/ });
    const few = pickAutoSet({ stats: [{ skillId: "x", misses: 2, answered: 0, correct: 0 }], pool: pool("x", AUTO_MIN - 1), exclude: new Set(), seen: new Set(), seed: "s" });
    expect(few).toMatchObject({ reason: /Only 7 published questions/ });
  });

  it("keeps the size within 8 to 12", () => {
    const args = { stats: [{ skillId: "x", misses: 2, answered: 0, correct: 0 }], pool: pool("x", 30), exclude: new Set<string>(), seen: new Set<string>(), seed: "s" };
    expect(pickAutoSet({ ...args, size: 50 }).questionIds).toHaveLength(12);
    expect(pickAutoSet({ ...args, size: 2 }).questionIds).toHaveLength(8);
  });

  it("swaps for another question on the same skill, close in difficulty", () => {
    const p = pool("x", 5);
    expect(swapFor({ current: ["x-0", "x-1"], out: p[0], pool: p, exclude: new Set(["x-3"]), seen: new Set() })?.id).toBe("x-4");
    expect(swapFor({ current: p.map((q) => q.id), out: p[0], pool: p, exclude: new Set(), seen: new Set() })).toBeNull();
  });

  it("weeks start on Monday (UTC)", () => {
    expect(weekOf(new Date("2026-11-19T15:00:00Z"))).toBe("2026-11-16");
    expect(weekOf(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11-16");
    expect(weekOf(new Date("2026-11-22T23:59:00Z"))).toBe("2026-11-16");
  });
});
