import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_TYPES, SEED_COURSES, SEED_TESTS, STANDARD_MODULES, skillRows } from "@/server/seed/reference";

/**
 * Content rule: no College Board question text, passages, images, explanations
 * or answer keys in any seed, fixture or prompt. Practice tests are names and
 * module sizes only; every bank question is original.
 */
const root = path.resolve(import.meta.dirname, "../..");

describe("seed content audit", () => {
  it("practice tests are metadata only (name, source, module sizes)", () => {
    for (const t of SEED_TESTS) expect(Object.keys(t).sort()).toEqual(["id", "name", "source"]);
    for (const m of STANDARD_MODULES) expect(Object.keys(m).sort()).toEqual(["number", "question_count", "section"]);
    expect(STANDARD_MODULES.reduce((n, m) => n + m.question_count, 0)).toBe(98);
  });

  it("skills and error types are short labels, not question content", () => {
    for (const s of skillRows()) expect(s.name.length).toBeLessThan(90);
    for (const e of ERROR_TYPES) expect(e.label.length).toBeLessThan(40);
    expect(ERROR_TYPES.map((e) => e.label)).toEqual(["Careless", "Concept gap", "Misread question", "Ran out of time", "Guessed", "Calculator/Desmos misuse"]);
  });

  it("seeded studio courses are empty drafts", () => {
    expect(SEED_COURSES.map((c) => c.title)).toEqual(["Desmos Masterclass", "Advanced EBRW"]);
  });

  it("seed and fixture sources don't carry answer keys or official question text", () => {
    const files = ["src/server/seed/reference.ts", "scripts/seed.ts", ...fs.readdirSync(path.join(root, "src/server/seed")).map((f) => `src/server/seed/${f}`)];
    for (const f of new Set(files)) {
      const text = fs.readFileSync(path.join(root, f), "utf8");
      expect(text, f).not.toMatch(/answer_?key\s*[:=]\s*[[{"]/i);
      expect(text, f).not.toMatch(/"(stem|passage|prompt)"\s*:/i);
    }
  });

  it("every question in the 1600 Project file is marked original", () => {
    const qs = JSON.parse(fs.readFileSync(path.join(root, "data/questions/1600-weeks3-6-questions.json"), "utf8")) as { source: string }[];
    expect(qs).toHaveLength(240);
    expect(qs.every((q) => q.source === "original")).toBe(true);
  });
});
