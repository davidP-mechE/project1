import { describe, expect, it } from "vitest";
import {
  addLesson,
  addUnit,
  deleteLesson,
  deleteUnit,
  formatPages,
  fromDraft,
  isUnitSkipped,
  mergeLessonWithNext,
  mergeUnitWithNext,
  moveLesson,
  moveUnit,
  renameLesson,
  renameUnit,
  setFrontBackMatterIncluded,
  setLessonRange,
  setLessonSkip,
  setUnitSkip,
  splitLesson,
  splitUnitAt,
  validateOutline,
  type EditableOutline,
} from "@/lib/outline/edit";

const L = (key: string, title: string, pageStart: number, pageEnd: number, extra: Partial<{ skip: boolean; isFrontBackMatter: boolean; id: string }> = {}) => ({
  key,
  id: extra.id ?? `id_${key}`,
  title,
  pageStart,
  pageEnd,
  skip: extra.skip ?? false,
  isFrontBackMatter: extra.isFrontBackMatter ?? false,
});

function sample(): EditableOutline {
  return {
    units: [
      { key: "u0", id: "U0", title: "Front matter", isFrontBackMatter: true, lessons: [L("f", "Front matter", 1, 2, { skip: true, isFrontBackMatter: true })] },
      { key: "u1", id: "U1", title: "1 Charge", isFrontBackMatter: false, lessons: [L("a", "1.1 Basics", 3, 4), L("b", "1.2 Current", 5, 6)] },
      { key: "u2", id: "U2", title: "2 Resistance", isFrontBackMatter: false, lessons: [L("c", "2.1 Resistors", 7, 12)] },
    ],
  };
}

const shape = (o: EditableOutline) => o.units.map((u) => `${u.title}: ${u.lessons.map((l) => `${l.title}[${l.pageStart}-${l.pageEnd}]`).join(", ")}`);

describe("outline edits never change the original", () => {
  it("returns a new object", () => {
    const o = sample();
    const before = JSON.stringify(o);
    renameLesson(o, 1, 0, "X");
    mergeLessonWithNext(o, 1, 0);
    moveLesson(o, 1, 0, 1);
    expect(JSON.stringify(o)).toBe(before);
  });
});

describe("rename", () => {
  it("renames units and lessons", () => {
    let o = renameUnit(sample(), 1, "Chapter 1: Charge");
    o = renameLesson(o, 1, 1, "1.2 Electric current");
    expect(shape(o)[1]).toBe("Chapter 1: Charge: 1.1 Basics[3-4], 1.2 Electric current[5-6]");
  });
});

describe("move", () => {
  it("swaps lessons within a unit", () => {
    expect(shape(moveLesson(sample(), 1, 0, 1))[1]).toBe("1 Charge: 1.2 Current[5-6], 1.1 Basics[3-4]");
  });
  it("moves a lesson across into the next unit (at the start)", () => {
    const o = moveLesson(sample(), 1, 1, 1);
    expect(shape(o).slice(1)).toEqual(["1 Charge: 1.1 Basics[3-4]", "2 Resistance: 1.2 Current[5-6], 2.1 Resistors[7-12]"]);
  });
  it("moves a lesson across into the previous unit (at the end) and removes an emptied unit", () => {
    const o = moveLesson(sample(), 2, 0, -1);
    expect(o.units).toHaveLength(2);
    expect(shape(o)[1]).toBe("1 Charge: 1.1 Basics[3-4], 1.2 Current[5-6], 2.1 Resistors[7-12]");
  });
  it("does nothing at the very start or end", () => {
    const o = sample();
    expect(moveLesson(o, 0, 0, -1)).toBe(o);
    expect(moveLesson(o, 2, 0, 1)).toBe(o);
    expect(moveUnit(o, 0, -1)).toBe(o);
  });
  it("moves units", () => expect(moveUnit(sample(), 2, -1).units.map((u) => u.key)).toEqual(["u0", "u2", "u1"]));
});

describe("merge and split", () => {
  it("merges a lesson with the next, keeping the first id and the full page range", () => {
    const o = mergeLessonWithNext(sample(), 1, 0);
    expect(o.units[1].lessons).toHaveLength(1);
    expect(o.units[1].lessons[0]).toMatchObject({ id: "id_a", title: "1.1 Basics", pageStart: 3, pageEnd: 6 });
  });
  it("ignores merging the last lesson of a unit", () => {
    const o = sample();
    expect(mergeLessonWithNext(o, 1, 1)).toBe(o);
  });
  it("splits a lesson at a page; the new half has no database id", () => {
    const o = splitLesson(sample(), 2, 0, 10);
    expect(shape(o)[2]).toBe("2 Resistance: 2.1 Resistors[7-9], 2.1 Resistors (continued)[10-12]");
    expect(o.units[2].lessons[0].id).toBe("id_c");
    expect(o.units[2].lessons[1].id).toBeUndefined();
    expect(o.units[2].lessons[1].key).not.toBe("c");
  });
  it("rejects split pages outside the lesson", () => {
    expect(() => splitLesson(sample(), 2, 0, 7)).toThrow(RangeError);
    expect(() => splitLesson(sample(), 2, 0, 13)).toThrow(RangeError);
  });
  it("merges units and splits a unit at a lesson", () => {
    const merged = mergeUnitWithNext(sample(), 1);
    expect(shape(merged)[1]).toBe("1 Charge: 1.1 Basics[3-4], 1.2 Current[5-6], 2.1 Resistors[7-12]");
    const split = splitUnitAt(merged, 1, 2, "2 Resistance again");
    expect(shape(split).slice(1)).toEqual(["1 Charge: 1.1 Basics[3-4], 1.2 Current[5-6]", "2 Resistance again: 2.1 Resistors[7-12]"]);
  });
});

describe("add and delete", () => {
  it("adds a lesson after another, starting on its last page", () => {
    const o = addLesson(sample(), 1, 0, 12, "1.1b Extra");
    expect(o.units[1].lessons[1]).toMatchObject({ title: "1.1b Extra", pageStart: 4, pageEnd: 4, skip: false });
    expect(o.units[1].lessons[1].id).toBeUndefined();
  });
  it("adds a unit with one lesson", () => {
    const o = addUnit(sample(), 2, 12, "3 Circuits");
    expect(o.units[3]).toMatchObject({ title: "3 Circuits" });
    expect(o.units[3].lessons).toHaveLength(1);
  });
  it("deleting the last lesson of a unit removes the unit", () => {
    expect(deleteLesson(sample(), 2, 0).units.map((u) => u.key)).toEqual(["u0", "u1"]);
    expect(deleteLesson(sample(), 1, 0).units[1].lessons.map((l) => l.key)).toEqual(["b"]);
  });
  it("deletes units", () => expect(deleteUnit(sample(), 0).units.map((u) => u.key)).toEqual(["u1", "u2"]));
});

describe("ranges and skipping", () => {
  it("sets page ranges", () => expect(setLessonRange(sample(), 1, 0, 2, 4).units[1].lessons[0]).toMatchObject({ pageStart: 2, pageEnd: 4 }));
  it("setting the same range is not a change (no extra Undo step)", () => {
    const o = sample();
    expect(setLessonRange(o, 1, 0, 3, 4)).toBe(o);
  });
  it("skips lessons and whole units", () => {
    expect(setLessonSkip(sample(), 1, 0, true).units[1].lessons[0].skip).toBe(true);
    const o = setUnitSkip(sample(), 1, true);
    expect(isUnitSkipped(o.units[1])).toBe(true);
    expect(isUnitSkipped(o.units[2])).toBe(false);
  });
  it("includes/excludes all front/back matter at once", () => {
    expect(setFrontBackMatterIncluded(sample(), true).units[0].lessons[0].skip).toBe(false);
    expect(setFrontBackMatterIncluded(sample(), false).units[0].lessons[0].skip).toBe(true);
    // Normal lessons are untouched.
    expect(setFrontBackMatterIncluded(sample(), false).units[1].lessons[0].skip).toBe(false);
  });
});

describe("validateOutline", () => {
  it("accepts a good outline", () => expect(validateOutline(sample(), 12)).toEqual({ errors: [], warnings: [] }));
  it("reports bad page ranges and empty titles", () => {
    let o = setLessonRange(sample(), 1, 0, 5, 3);
    o = setLessonRange(o, 1, 1, 5, 99);
    o = renameUnit(o, 2, "   ");
    const { errors } = validateOutline(o, 12);
    expect(errors.map((e) => e.message)).toEqual([
      "A unit has no title.",
      '"1.1 Basics": the first page comes after the last page.',
      '"1.2 Current": pages must be between 1 and 12.',
    ]);
    expect(errors[1].lessonKey).toBe("a");
  });
  it("refuses an outline where everything is skipped", () => {
    let o = sample();
    for (let i = 0; i < o.units.length; i++) o = setUnitSkip(o, i, true);
    expect(validateOutline(o, 12).errors[0].message).toMatch(/Every lesson is skipped/);
  });
  it("warns about uncovered pages and very long lessons", () => {
    let o = setLessonRange(sample(), 1, 1, 5, 5); // page 6 now uncovered
    o = addUnit(o, 2, 100);
    o = setLessonRange(o, 3, 0, 13, 60); // 48 pages
    const { errors, warnings } = validateOutline(o, 60);
    expect(errors).toEqual([]);
    expect(warnings.map((w) => w.message)).toEqual([
      '"New lesson" covers 48 pages. Long lessons are harder to study; consider splitting it.',
      "No lesson covers page 6.",
    ]);
  });
  it("requires at least one unit", () => expect(validateOutline({ units: [] }, 5).errors).toHaveLength(2 - 1));
});

describe("helpers", () => {
  it("formats page lists compactly", () => {
    expect(formatPages([1, 2, 3, 7, 9, 10])).toBe("1–3, 7, 9–10");
    expect(formatPages([1, 3, 5, 7, 9], 3)).toBe("1, 3, 5 and more");
  });
  it("converts a detected outline, skipping front/back matter", () => {
    const o = fromDraft([
      { title: "Index", pageStart: 9, pageEnd: 9, isFrontBackMatter: true, lessons: [{ title: "Index", pageStart: 9, pageEnd: 9, isFrontBackMatter: true }] },
    ]);
    expect(o.units[0].lessons[0]).toMatchObject({ title: "Index", skip: true });
    expect(o.units[0].key).toBeTruthy();
  });
});
