import { describe, expect, it } from "vitest";
import { itemsToLines, linesToText, type TextItem } from "@/lib/pdf/lines";
import { garbageRatio, needsOcr } from "@/lib/pdf/text-quality";
import { MATH_HEAVY_THRESHOLD, mathScore } from "@/lib/pdf/math-score";

const item = (str: string, x: number, y: number, size = 12, width = str.length * size * 0.5): TextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
});

describe("itemsToLines", () => {
  it("groups fragments on the same baseline, top to bottom, left to right", () => {
    const lines = itemsToLines([item("world", 100, 700), item("Hello", 50, 700), item("Second line", 50, 685)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "Second line"]);
    expect(lines[0].size).toBe(12);
  });

  it("keeps subscripts on the same line and reports the main font size", () => {
    const lines = itemsToLines([item("R", 50, 700), item("1", 56.5, 697, 8, 4), item(" + R", 60.5, 700)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("R1 + R");
    expect(lines[0].size).toBe(12);
  });

  it("measures heading font sizes", () => {
    const lines = itemsToLines([item("2.1 Resistors", 57, 661, 17), item("Body text here.", 57, 630)]);
    expect(lines.map((l) => l.size)).toEqual([17, 12]);
  });
});

describe("linesToText", () => {
  it("joins wrapped lines, starts paragraphs at large gaps, and repairs hyphenation", () => {
    const text = linesToText([
      { text: "Current is the flow of elec-", size: 12, x: 0, y: 700 },
      { text: "tric charge through a wire.", size: 12, x: 0, y: 685 },
      { text: "A new paragraph begins.", size: 12, x: 0, y: 650 },
    ]);
    expect(text).toBe("Current is the flow of electric charge through a wire.\n\nA new paragraph begins.");
  });

  it("keeps hyphens that are part of a word", () => {
    expect(
      linesToText([
        { text: "a well-", size: 12, x: 0, y: 700 },
        { text: "Known result", size: 12, x: 0, y: 685 },
      ]),
    ).toBe("a well- Known result");
  });

  it("separates a heading from the following body text", () => {
    expect(
      linesToText([
        { text: "1.1 Charge", size: 17, x: 0, y: 700 },
        { text: "Charge is a property of matter.", size: 12, x: 0, y: 680 },
      ]),
    ).toBe("1.1 Charge\n\nCharge is a property of matter.");
  });
});

describe("needsOcr", () => {
  it("OCRs scanned pages (no text, has an image)", () => expect(needsOcr("", 1)).toBe(true));
  it("doesn't OCR blank pages without images", () => expect(needsOcr("  ", 0)).toBe(false));
  it("doesn't OCR normal text pages", () =>
    expect(needsOcr("This page has plenty of perfectly normal text on it, and a picture.", 2)).toBe(false));
  it("OCRs pages whose text is mostly broken glyphs", () => {
    const broken = "\uE001\uE002\uE003\uE004\uE005 \uE006\uE007\uE008 \uFFFD\uFFFD\uFFFD\uFFFD ab ".repeat(3);
    expect(garbageRatio(broken)).toBeGreaterThan(0.3);
    expect(needsOcr(broken, 0)).toBe(true);
  });
});

describe("mathScore", () => {
  const prose =
    "Electric current is the rate at which charge flows past a point in a circuit. In this chapter we explore how batteries push charge around a loop and why wires get warm.";
  const math = "V = I × R   P = I² R = V² / R   R_total = R₁ + R₂ + R₃   1/R = Σ 1/Rᵢ   ΔV ≈ 0.5 Ω × 2 A   τ = R C   ∫ I dt = Q";

  it("scores plain prose near zero", () => expect(mathScore(prose)).toBeLessThan(0.05));
  it("scores equation-heavy text above the threshold", () => expect(mathScore(math)).toBeGreaterThan(MATH_HEAVY_THRESHOLD));
  it("scores a page mixing prose and a few equations in between", () => {
    const mixed = `${prose} ${prose} ${math}`;
    const s = mathScore(mixed);
    expect(s).toBeGreaterThan(mathScore(prose));
    expect(s).toBeLessThan(mathScore(math));
  });
  it("returns 0 for nearly empty pages", () => expect(mathScore("x = 2")).toBe(0));
});
