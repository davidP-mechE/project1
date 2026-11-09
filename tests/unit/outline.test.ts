import { describe, expect, it } from "vitest";
import { buildOutline, MAX_LESSON_PAGES, pageRangeOutline, splitRange } from "@/lib/outline/build";
import { entriesFromBookmarks, type Bookmark } from "@/lib/outline/from-bookmarks";
import { classifyPageText, classifyTitle } from "@/lib/outline/front-back-matter";
import { bodyFontSize, detectHeadings, type PageLines } from "@/lib/outline/heading-detect";
import type { OutlineEntry } from "@/lib/outline/types";

const bm = (title: string, page: number | null, children: Bookmark[] = [], startsAtTop = true): Bookmark => ({
  title,
  page,
  startsAtTop,
  children,
});

describe("classifyTitle", () => {
  it.each(["Contents", "Table of Contents", "Copyright", "Preface", "Acknowledgments", "List of Figures", "About the Author"])(
    "%s is front matter",
    (t) => expect(classifyTitle(t)).not.toBeNull(),
  );
  it.each(["Index", "Subject Index", "Bibliography", "References", "Glossary", "Answers to Odd-Numbered Problems", "12 References"])(
    "%s is back matter",
    (t) => expect(classifyTitle(t)).toBe("back"),
  );
  it.each(["1 Electric Charge and Current", "Introduction", "Appendix A: Math Review", "Preface to Ohm's Law Experiments in Labs", "Indexing Data"])(
    "%s is real content",
    (t) => expect(classifyTitle(t)).toBeNull(),
  );
});

describe("classifyPageText", () => {
  it("detects a copyright page", () =>
    expect(classifyPageText("Copyright © 2026 Example Press. All rights reserved.\n\nISBN 978-0-00-000000-0")).toBe("copyright"));
  it("detects a contents page", () =>
    expect(classifyPageText("Contents\n1 Charge 4\n1.1 Basics 4\n2 Current 6\n3 Resistance 9")).toBe("contents"));
  it("detects an index page", () =>
    expect(classifyPageText("charge, 4, 5\ncurrent, 5, 6\nOhm's law, 7\nparallel circuit, 8\nresistor, 6, 7\nseries circuit, 8–9")).toBe("index"));
  it("leaves normal pages alone", () =>
    expect(classifyPageText("Electric charge is a basic property of matter. In 2026, copyright law was not discussed here.")).toBeNull());
});

describe("entriesFromBookmarks", () => {
  it("maps chapters to level 1 and sections to level 2", () => {
    const entries = entriesFromBookmarks(
      [bm("Contents", 3), bm("1 Charge", 4, [bm("1.1 Basics", 4, [], false), bm("1.2 Current", 5)]), bm("Index", 10)],
      10,
    );
    expect(entries.map((e) => [e.title, e.level, e.page])).toEqual([
      ["Contents", 1, 3],
      ["1 Charge", 1, 4],
      ["1.1 Basics", 2, 4],
      ["1.2 Current", 2, 5],
      ["Index", 1, 10],
    ]);
  });

  it("unwraps 'Part' groupings so chapters become units", () => {
    const entries = entriesFromBookmarks(
      [
        bm("Part I Foundations", 1, [bm("1 Charge", 1, [bm("1.1 Basics", 2)]), bm("2 Current", 5)]),
        bm("Part II Circuits", 9, [bm("3 Resistors", 9)]),
      ],
      20,
    );
    expect(entries.filter((e) => e.level === 1).map((e) => e.title)).toEqual(["1 Charge", "2 Current", "3 Resistors"]);
    expect(entries.find((e) => e.title === "1.1 Basics")?.level).toBe(2);
  });

  it("skips a single root bookmark (the book title) wrapping everything", () => {
    const entries = entriesFromBookmarks([bm("My Book", 1, [bm("1 A", 2), bm("2 B", 5)])], 10);
    expect(entries.map((e) => e.title)).toEqual(["1 A", "2 B"]);
  });

  it("drops bookmarks pointing nowhere and uses the first section's page for a chapter without one", () => {
    const entries = entriesFromBookmarks([bm("Broken", null), bm("1 A", null, [bm("1.1 X", 3)]), bm("Out of range", 99)], 10);
    expect(entries.map((e) => [e.title, e.page])).toEqual([
      ["1 A", 3],
      ["1.1 X", 3],
    ]);
  });
});

describe("detectHeadings", () => {
  const body = (text: string, y: number) => ({ text, size: 12, x: 57, y });
  const pages: PageLines[] = [
    { pageNumber: 1, lines: [{ text: "Basic Circuits", size: 34, x: 150, y: 500 }] },
    { pageNumber: 2, lines: [body("Copyright © 2026 Example Press. All rights reserved.", 700)] },
    {
      pageNumber: 3,
      lines: [{ text: "1 Electric Charge and Current", size: 26, x: 57, y: 707 }, { text: "1.1 Charge", size: 17, x: 57, y: 661 }, body("Charge is a property of matter that we study in detail here.", 630), body("Footer text", 40), body("3", 30)],
    },
    { pageNumber: 4, lines: [{ text: "1.2 Current", size: 17, x: 57, y: 699 }, body("Current is the flow of charge through a conductor over time.", 670), body("Footer text", 40), body("4", 30)] },
    {
      pageNumber: 5,
      lines: [
        { text: "2 Resistance and", size: 26, x: 57, y: 707 },
        { text: "Ohm's Law", size: 26, x: 57, y: 680 },
        body("Resistance opposes current in every material we know about.", 640),
        body("Footer text", 40),
        body("5", 30),
      ],
    },
    { pageNumber: 6, lines: [body("More text continues on this page about resistance.", 700), { text: "2.1 Resistors", size: 17, x: 57, y: 500 }, body("Resistors are parts.", 470), body("Footer text", 40), body("6", 30)] },
  ];

  it("finds the body font size", () => expect(bodyFontSize(pages)).toBe(12));

  it("detects chapters and sections by size, merges two-line headings, ignores the title page and footers", () => {
    const entries = detectHeadings(pages);
    expect(entries.map((e) => [e.title, e.level, e.page, e.startsAtTop])).toEqual([
      ["1 Electric Charge and Current", 1, 3, true],
      ["1.1 Charge", 2, 3, false],
      ["1.2 Current", 2, 4, true],
      ["2 Resistance and Ohm's Law", 1, 5, true],
      ["2.1 Resistors", 2, 6, false],
    ]);
  });

  it("uses numbering when all headings are the same size", () => {
    const same: PageLines[] = [
      { pageNumber: 1, lines: [{ text: "1 Motion", size: 18, x: 0, y: 700 }, body("Text about motion and speed in everyday life.", 650)] },
      { pageNumber: 2, lines: [{ text: "1.1 Speed", size: 18, x: 0, y: 700 }, body("Speed tells us how fast something moves along.", 650)] },
      { pageNumber: 3, lines: [{ text: "2 Forces", size: 18, x: 0, y: 700 }, body("Forces push and pull objects in different ways.", 650)] },
    ];
    expect(detectHeadings(same).map((e) => e.level)).toEqual([1, 2, 1]);
  });

  it("returns nothing for a book with no visible headings", () =>
    expect(detectHeadings([{ pageNumber: 1, lines: [body("Just text.", 700)] }])).toEqual([]));
});

describe("buildOutline", () => {
  const e = (title: string, level: 1 | 2, page: number, startsAtTop = true): OutlineEntry => ({ title, level, page, startsAtTop });

  it("builds units and lessons with page ranges, front matter and back matter", () => {
    const units = buildOutline(
      [
        e("Contents", 1, 3),
        e("1 Charge", 1, 4),
        e("1.1 Basics", 2, 4, false),
        e("1.2 Current", 2, 5),
        e("2 Resistance", 1, 6),
        e("2.1 Resistors", 2, 6, false),
        e("2.2 Ohm's Law", 2, 7, false), // starts mid-page: 2.1 shares page 7
        e("3 Circuits", 1, 8),
        e("Index", 1, 10),
      ],
      10,
    );
    expect(units.map((u) => [u.title, u.pageStart, u.pageEnd, u.isFrontBackMatter])).toEqual([
      ["Front matter", 1, 2, true],
      ["Contents", 3, 3, true],
      ["1 Charge", 4, 5, false],
      ["2 Resistance", 6, 7, false],
      ["3 Circuits", 8, 9, false],
      ["Index", 10, 10, true],
    ]);
    const ch1 = units[2].lessons.map((l) => [l.title, l.pageStart, l.pageEnd]);
    expect(ch1).toEqual([
      ["1.1 Basics", 4, 4],
      ["1.2 Current", 5, 5],
    ]);
    const ch2 = units[3].lessons.map((l) => [l.title, l.pageStart, l.pageEnd]);
    expect(ch2).toEqual([
      ["2.1 Resistors", 6, 7],
      ["2.2 Ohm's Law", 7, 7],
    ]);
    // A chapter with no sections becomes a single lesson.
    expect(units[4].lessons).toEqual([{ title: "3 Circuits", pageStart: 8, pageEnd: 9, isFrontBackMatter: false }]);
  });

  it("first lesson includes the chapter introduction before the first section", () => {
    const units = buildOutline([e("1 Waves", 1, 1), e("1.1 Sound", 2, 3)], 5);
    expect(units[0].lessons[0]).toMatchObject({ title: "1.1 Sound", pageStart: 1, pageEnd: 5 });
  });

  it("marks a unit as front/back matter when all its pages are flagged", () => {
    const units = buildOutline([e("Unknown heading", 1, 1), e("1 Real", 1, 2)], 3, [{ pageNumber: 1, frontBack: true }]);
    expect(units[0].isFrontBackMatter).toBe(true);
    expect(units[1].isFrontBackMatter).toBe(false);
  });

  it(`splits lessons longer than ${MAX_LESSON_PAGES} pages into parts`, () => {
    const units = buildOutline([e("1 Huge Chapter", 1, 1)], 60);
    const lessons = units[0].lessons;
    expect(lessons.length).toBeGreaterThan(1);
    expect(lessons[0].title).toMatch(/part 1 of/);
    expect(lessons[0].pageStart).toBe(1);
    expect(lessons.at(-1)!.pageEnd).toBe(60);
    for (let i = 1; i < lessons.length; i++) expect(lessons[i].pageStart).toBe(lessons[i - 1].pageEnd + 1);
  });

  it("falls back to fixed page ranges with no headings", () => {
    const units = buildOutline([], 125);
    expect(units).toHaveLength(2);
    expect(units[0].lessons).toHaveLength(10);
    expect(units[1].lessons.at(-1)).toMatchObject({ title: "Pages 121–125", pageStart: 121, pageEnd: 125 });
    expect(pageRangeOutline(0)).toEqual([]);
  });

  it("covers every page exactly once across units (no gaps)", () => {
    const units = buildOutline([e("A", 1, 2), e("A.1", 2, 2), e("A.2", 2, 4), e("B", 1, 7, false), e("C", 1, 9)], 12);
    const covered = new Set<number>();
    for (const u of units) for (let p = u.pageStart; p <= u.pageEnd; p++) covered.add(p);
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("splitRange keeps short ranges whole", () =>
    expect(splitRange("X", 3, 10, false)).toEqual([{ title: "X", pageStart: 3, pageEnd: 10, isFrontBackMatter: false }]));
});
