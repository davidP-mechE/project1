import { describe, expect, it } from "vitest";
import { checkBankAnswer, gridInCorrect } from "@/lib/bank/answers";

describe("grid-in answers", () => {
  it("accepts equivalent forms", () => {
    expect(gridInCorrect("0.75", "3/4")).toBe(true);
    expect(gridInCorrect(".75", "3/4")).toBe(true);
    expect(gridInCorrect("6/8", "3/4")).toBe(true);
    expect(gridInCorrect("3/4", "0.75")).toBe(true);
    expect(gridInCorrect("12.50", "12.5")).toBe(true);
    expect(gridInCorrect("-6", "−6")).toBe(true);
    expect(gridInCorrect("−21", "-21")).toBe(true);
    expect(gridInCorrect("5130", "5130")).toBe(true);
  });

  it("accepts a repeating decimal rounded or cut off to 3+ places, not fewer", () => {
    expect(gridInCorrect(".666", "2/3")).toBe(true);
    expect(gridInCorrect(".667", "2/3")).toBe(true);
    expect(gridInCorrect("0.6667", "2/3")).toBe(true);
    expect(gridInCorrect("0.67", "2/3")).toBe(false);
    expect(gridInCorrect(".665", "2/3")).toBe(false);
    expect(gridInCorrect("-.333", "-1/3")).toBe(true);
  });

  it("rejects wrong values, mixed numbers and junk", () => {
    expect(gridInCorrect("0.7", "3/4")).toBe(false);
    expect(gridInCorrect("1 1/2", "3/2")).toBe(false);
    expect(gridInCorrect("", "3/4")).toBe(false);
    expect(gridInCorrect("abc", "3/4")).toBe(false);
  });

  it("allows several accepted answers", () => {
    expect(gridInCorrect("4", "-4|4")).toBe(true);
  });
});

describe("likely mistake", () => {
  it("shows the note for the wrong MCQ letter picked", () => {
    const q = { type: "mcq" as const, answer: "D", distractorNotes: { A: "Didn't distribute.", B: "Stopped early." } };
    expect(checkBankAnswer(q, "A")).toMatchObject({ correct: false, likelyMistake: "Didn't distribute." });
    expect(checkBankAnswer(q, "d")).toMatchObject({ correct: true, likelyMistake: null });
    expect(checkBankAnswer(q, "C").likelyMistake).toBeNull();
  });

  it("matches a wrong grid-in value to its note, in any equivalent form", () => {
    const q = { type: "grid_in" as const, answer: "9", distractorNotes: { "−5": "That's the slope.", "−31": "Sign error." } };
    expect(checkBankAnswer(q, "-5")).toMatchObject({ correct: false, likelyMistake: "That's the slope." });
    expect(checkBankAnswer(q, "-10/2").likelyMistake).toBe("That's the slope.");
    expect(checkBankAnswer(q, "7").likelyMistake).toBeNull();
  });
});
