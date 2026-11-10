import { describe, expect, it } from "vitest";
import { costUsd } from "@/lib/ai/models";
import { DEFAULT_SETTINGS, parseSettings, questionTypesOn } from "@/lib/course/settings";
import { DEFAULT_PLAN, estimateGeneration, LEGACY_PLAN, planFor, type EstimateLesson } from "@/lib/usage/estimate";

describe("parseSettings", () => {
  it("fills in defaults for missing settings", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ level: "high_school", style: "detailed", includeFrontBackMatter: false, questionsPerLesson: 6 });
    expect(DEFAULT_SETTINGS.contentTypes).toContain("flashcards");
  });
  it("keeps valid values and replaces only invalid ones", () => {
    const s = parseSettings({ level: "college", style: "fancy", questionsPerLesson: 99, contentTypes: ["flashcards", "flashcards"] });
    expect(s.level).toBe("college");
    expect(s.style).toBe("detailed"); // invalid → default
    expect(s.questionsPerLesson).toBe(6); // out of range → default
    expect(s.contentTypes).toEqual(["flashcards"]); // de-duplicated
  });
  it("lists which question types are on", () =>
    expect(questionTypesOn({ ...DEFAULT_SETTINGS, contentTypes: ["shortAnswer", "flashcards"] })).toEqual(["shortAnswer"]));
});

describe("estimateGeneration", () => {
  // 100 pages of ~3,200 characters (~800 tokens) each, in 10 lessons over 3 units.
  const lessons: EstimateLesson[] = Array.from({ length: 10 }, (_, i) => ({
    unitKey: `u${Math.floor(i / 4)}`,
    pages: 10,
    chars: 32_000,
    mathHeavyPages: 0,
  }));

  it("lands near the README's per-100-page figures with default settings", () => {
    const e = estimateGeneration(lessons, DEFAULT_SETTINGS);
    expect(e.lessons).toBe(10);
    expect(e.units).toBe(3);
    expect(e.pages).toBe(100);
    expect(e.costUsd).toBeGreaterThan(0.5);
    expect(e.costUsd).toBeLessThan(1);
    expect(e.minutes).toBeGreaterThanOrEqual(1);
    const legacy = estimateGeneration(lessons, DEFAULT_SETTINGS, LEGACY_PLAN);
    expect(legacy.costUsd).toBeGreaterThan(1.2);
    expect(legacy.costUsd).toBeLessThan(2);
  });

  it("breaks the cost down by step, with the simple steps on the small model and batching at half price", () => {
    const mathy = lessons.map((l) => ({ ...l, mathHeavyPages: 2 }));
    const e = estimateGeneration(mathy, DEFAULT_SETTINGS);
    const step = (id: string) => e.steps.find((s) => s.step === id)!;
    expect(step("lessons")).toMatchObject({ model: "claude-sonnet-5-5", batch: true });
    expect(step("flashcards")).toMatchObject({ model: "claude-haiku-5-5", batch: true });
    expect(step("pageReading")).toMatchObject({ model: "claude-haiku-5-5", batch: false });
    expect(e.costUsd).toBeCloseTo(e.steps.reduce((n, s) => n + s.costUsd, 0), 2);
    const unbatched = estimateGeneration(mathy, DEFAULT_SETTINGS, { ...DEFAULT_PLAN, batch: false });
    expect(unbatched.steps.find((s) => s.step === "lessons")!.costUsd).toBeCloseTo(step("lessons").costUsd * 2);
    expect(estimateGeneration(mathy, DEFAULT_SETTINGS, LEGACY_PLAN).costUsd / e.costUsd).toBeGreaterThan(2);
  });

  it("High quality uses the main model for every step and costs more", () => {
    const mathy = lessons.map((l) => ({ ...l, mathHeavyPages: 2 }));
    const standard = estimateGeneration(mathy, DEFAULT_SETTINGS);
    const high = estimateGeneration(mathy, { ...DEFAULT_SETTINGS, quality: "high" });
    expect(new Set(high.steps.map((s) => s.model))).toEqual(new Set(["claude-sonnet-5-5"]));
    expect(high.costUsd).toBeGreaterThan(standard.costUsd);
    expect(planFor({ quality: "high" }, false)).toMatchObject({ batch: false, flashcardModel: "claude-sonnet-5-5", visionModel: "claude-sonnet-5-5" });
    expect(DEFAULT_SETTINGS.quality).toBe("standard");
  });

  it("costs less with fewer content types and concise style", () => {
    const full = estimateGeneration(lessons, DEFAULT_SETTINGS);
    const lean = estimateGeneration(lessons, { ...DEFAULT_SETTINGS, style: "concise", contentTypes: ["objectives"] });
    expect(lean.costUsd).toBeLessThan(full.costUsd / 2);
  });

  it("adds the cost of re-reading equation-heavy pages", () => {
    const plain = estimateGeneration(lessons, DEFAULT_SETTINGS);
    const mathy = estimateGeneration(lessons.map((l) => ({ ...l, mathHeavyPages: 5 })), DEFAULT_SETTINGS);
    expect(mathy.costUsd).toBeGreaterThan(plain.costUsd);
  });

  it("is zero for an empty course", () => expect(estimateGeneration([], DEFAULT_SETTINGS)).toMatchObject({ costUsd: 0, lessons: 0 }));
});

describe("costUsd", () => {
  it("uses per-million-token prices", () => {
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 0)).toBe(2);
    expect(costUsd("claude-opus-5-5", 0, 1_000_000)).toBe(20);
  });
});

describe("estimate scales with lesson length", () => {
  it("budgets a shorter explanation for very short lessons", () => {
    const short = estimateGeneration([{ unitKey: "u", pages: 1, chars: 800, mathHeavyPages: 0 }], { ...DEFAULT_SETTINGS, contentTypes: [] });
    const long = estimateGeneration([{ unitKey: "u", pages: 15, chars: 48_000, mathHeavyPages: 0 }], { ...DEFAULT_SETTINGS, contentTypes: [] });
    expect(short.outputTokens).toBeLessThan(long.outputTokens / 2);
  });
});
