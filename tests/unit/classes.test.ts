import { describe, expect, it } from "vitest";
import { normalizeWorksheet, worksheetUserText } from "@/lib/ai/worksheet";
import { parseRanges } from "@/components/classes/worksheet-editor";
import { safeNext } from "@/lib/safe-next";
import { sampleWorksheet } from "../helpers/fake-claude";

describe("worksheets", () => {
  it("cleans up what Claude lists", () => {
    const items = normalizeWorksheet(sampleWorksheet(), 2);
    expect(items).toHaveLength(3); // the empty question is dropped
    expect(items[0]).toMatchObject({ type: "MULTIPLE_CHOICE", correctChoice: 1, answer: "5", answerSource: "WORKSHEET" });
    expect(items[1]).toMatchObject({ type: "SHORT_ANSWER", choices: [], correctChoice: null, pageRefs: [1] }); // a broken option list becomes a written answer
    expect(items[2]).toMatchObject({ answerSource: "CLAUDE", topic: "Linear equations" });
  });

  it("tells Claude the pages come as images first, with their text", () => {
    const msg = worksheetUserText("Unit 2 quiz", [
      { pageNumber: 1, text: "1. Solve x + 2 = 5", png: null },
      { pageNumber: 2, text: "  ", png: null },
    ]);
    expect(msg).toContain('Worksheet: "Unit 2 quiz" (2 pages');
    expect(msg).toContain("=== Page 1 ===\n1. Solve x + 2 = 5");
    expect(msg).toContain("=== Page 2 ===\n(no text layer: read the image)");
  });

  it("picks questions by number ranges", () => {
    expect(parseRanges("1-3, 7 10-8", 9)).toEqual([1, 2, 3, 7, 8, 9]);
    expect(parseRanges("0, abc, 4-4", 5)).toEqual([4]);
  });
});

describe("going back after logging in", () => {
  it("only allows paths on this site", () => {
    expect(safeNext("/join/K7Q2MXA")).toBe("/join/K7Q2MXA");
    expect(safeNext("//evil.example")).toBe("/library");
    expect(safeNext("https://evil.example")).toBe("/library");
    expect(safeNext("/join/x?y=1")).toBe("/library");
    expect(safeNext(undefined)).toBe("/library");
  });
});
