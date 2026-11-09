import { describe, expect, it } from "vitest";
import { buildTsQuery, splitHighlights } from "@/lib/search/query";
import { describeRange, locate } from "@/lib/highlights/anchor";
import { notesToMarkdown } from "@/lib/export/notes-markdown";

describe("buildTsQuery", () => {
  it("requires all words and prefix-matches the last one", () => {
    expect(buildTsQuery("Ohm law")).toBe("ohm & law:*");
    expect(buildTsQuery("capac")).toBe("capac:*");
  });
  it("supports phrases, exclusions and OR", () => {
    expect(buildTsQuery('"internal resistance" battery')).toBe("(internal <-> resistance) & battery:*");
    expect(buildTsQuery("current -alternating")).toBe("current & !alternating");
    expect(buildTsQuery("resistor or capacitor")).toBe("resistor | capacitor:*");
    expect(buildTsQuery("Ohm's")).toBe("(ohm <-> s)");
  });
  it("strips anything that could be a tsquery operator", () => {
    for (const nasty of ["a & b | !c", "x:* <-> y", "'; DROP TABLE \"Lesson\"; --", "(((a", "a\\b"]) {
      const q = buildTsQuery(nasty)!;
      expect(q).toMatch(/^[\p{L}\p{N}():*!&|<\-> ]+$/u);
      expect(q).not.toContain("'");
      expect(q).not.toContain(";");
    }
  });
  it("returns null when there's nothing to search for", () => {
    for (const empty of ["", "   ", "!!!", "-only -negatives", '""']) expect(buildTsQuery(empty)).toBeNull();
  });
  it("handles accented and non-Latin words", () => expect(buildTsQuery("Ampère Ω 電流")).toBe("ampère & ω & 電流:*"));
});

describe("splitHighlights", () => {
  it("marks matches without producing HTML", () => {
    expect(splitHighlights("The \u0001current\u0002 flows <b>")).toEqual([
      { text: "The ", match: false },
      { text: "current", match: true },
      { text: " flows <b>", match: false },
    ]);
  });
});

describe("highlight anchors", () => {
  const text = "Current is the flow of charge. The current in a series circuit is the same everywhere.";
  it("describes a selection with context, trimming spaces", () => {
    const start = text.indexOf("current in");
    const a = describeRange(text, start - 1, start + "current".length + 1)!;
    expect(a.exact).toBe("current");
    expect(a.prefix.endsWith("charge. The ")).toBe(true);
    expect(a.suffix.startsWith(" in a series")).toBe(true);
    expect(describeRange(text, 5, 5)).toBeNull();
    expect(describeRange("x".repeat(3000), 0, 2500)).toBeNull();
  });
  it("finds the right occurrence when the same words appear twice", () => {
    const second = text.indexOf("current in");
    const a = describeRange(text, second, second + 7)!;
    expect(locate(text, a)).toEqual({ start: second, end: second + 7 });
  });
  it("still finds the passage after nearby text changes, and reports it gone when it is", () => {
    const a = describeRange(text, text.indexOf("series circuit"), text.indexOf("series circuit") + 14)!;
    const edited = `Intro added. ${text.replace("everywhere", "at every point")}`;
    expect(edited.slice(locate(edited, a)!.start, locate(edited, a)!.end)).toBe("series circuit");
    expect(locate("A totally rewritten lesson.", a)).toBeNull();
  });
});

describe("notes export", () => {
  it("groups by unit and lesson, quotes highlights safely, skips empty lessons", () => {
    const md = notesToMarkdown(
      "Basic Circuits",
      [
        { title: "1.1 Charge", unitTitle: "1 Charge", pageStart: 3, pageEnd: 4, note: "Remember **Q = It**.", highlights: [{ exact: "line one\nline two", note: "why?", color: "YELLOW" }] },
        { title: "1.2 Current", unitTitle: "1 Charge", pageStart: 5, pageEnd: 5, note: null, highlights: [] },
        { title: "2.1 Ohm", unitTitle: "2 Ohm", pageStart: 7, pageEnd: 8, note: "  ", highlights: [{ exact: "# not a heading", note: "", color: "BLUE" }] },
      ],
      new Date("2026-11-09T12:00:00Z"),
    );
    expect(md).toContain("# Basic Circuits: my notes");
    expect(md).toContain("_Exported from Coursebook on 2026-11-09._");
    expect(md).toContain("## 1 Charge\n\n### 1.1 Charge (pp. 3–4)\n\nRemember **Q = It**.");
    expect(md).toContain("> line one\n> line two\n\nwhy?");
    expect(md).not.toContain("1.2 Current");
    expect(md).toContain("> # not a heading");
    expect(md.endsWith("\n")).toBe(true);
  });
  it("says so when there's nothing", () => expect(notesToMarkdown("X", [], new Date())).toContain("No notes or highlights yet."));
});
