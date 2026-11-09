import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import {
  getEstimateInputs,
  getOutlineForEditing,
  getPagePreview,
  getSettings,
  OutlineInvalidError,
  OutlineLockedError,
  saveOutline,
  saveSettings,
} from "@/server/outline";
import { deleteLesson, mergeLessonWithNext, moveLesson, renameLesson, setLessonRange, splitLesson } from "@/lib/outline/edit";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";

/** A processed 12-page course: front matter, two chapters, an index. */
async function course(status: "OUTLINE_DRAFT" | "PROCESSING" = "OUTLINE_DRAFT") {
  const user = await createUser();
  const book = await db.book.create({
    data: { userId: user.id, originalFilename: "b.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 12 },
  });
  await db.page.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      bookId: book.id,
      pageNumber: i + 1,
      text: i === 6 ? "V = I × R and P = I² R = V² / R so Σ 1/Rᵢ ≈ 0.5 Ω × 2 A" : `Page ${i + 1} text. `.repeat(40),
      charCount: 400,
      mathScore: i === 6 ? 0.5 : 0,
      width: 612,
      height: 792,
    })),
  });
  const c = await db.course.create({
    data: {
      userId: user.id,
      bookId: book.id,
      title: "Circuits",
      status,
      detectedOutline: [
        { title: "Front matter", pageStart: 1, pageEnd: 2, isFrontBackMatter: true, lessons: [{ title: "Front matter", pageStart: 1, pageEnd: 2, isFrontBackMatter: true }] },
        { title: "1 Charge", pageStart: 3, pageEnd: 6, isFrontBackMatter: false, lessons: [{ title: "1.1 Basics", pageStart: 3, pageEnd: 4, isFrontBackMatter: false }, { title: "1.2 Current", pageStart: 5, pageEnd: 6, isFrontBackMatter: false }] },
      ],
    },
  });
  const unit = (order: number, title: string, fb: boolean, lessons: [string, number, number][]) =>
    db.unit.create({
      data: {
        courseId: c.id,
        order,
        title,
        isFrontBackMatter: fb,
        lessons: { create: lessons.map(([t, s, e], i) => ({ courseId: c.id, order: i, title: t, pageStart: s, pageEnd: e, isFrontBackMatter: fb, skip: fb })) },
      },
    });
  await unit(0, "Front matter", true, [["Front matter", 1, 2]]);
  await unit(1, "1 Charge", false, [["1.1 Basics", 3, 4], ["1.2 Current", 5, 6]]);
  await unit(2, "2 Resistance", false, [["2.1 Resistors", 7, 11]]);
  await unit(3, "Index", true, [["Index", 12, 12]]);
  return { user, book, course: c };
}

beforeEach(resetDb);

describe("getOutlineForEditing", () => {
  it("returns units and lessons in order, with ids as keys", async () => {
    const { user, course: c } = await course();
    const data = await getOutlineForEditing(user.id, c.id);
    expect(data.pageCount).toBe(12);
    expect(data.editable).toBe(true);
    expect(data.outline.units.map((u) => u.title)).toEqual(["Front matter", "1 Charge", "2 Resistance", "Index"]);
    expect(data.outline.units[1].lessons[0].key).toBe(data.outline.units[1].lessons[0].id);
    expect(data.outline.units[0].lessons[0].skip).toBe(true);
    expect(data.detected?.units.map((u) => u.title)).toEqual(["Front matter", "1 Charge"]);
  });
});

describe("saveOutline", () => {
  it("keeps lesson ids through renames, moves, merges and splits", async () => {
    const { user, course: c } = await course();
    const { outline } = await getOutlineForEditing(user.id, c.id);
    const basicsId = outline.units[1].lessons[0].id!;
    const resistorsId = outline.units[2].lessons[0].id!;

    let o = renameLesson(outline, 1, 0, "1.1 What is charge?");
    o = moveLesson(o, 1, 1, 1); // 1.2 → start of unit 2
    o = splitLesson(o, 2, 1, 9); // 2.1 Resistors [7-11] → [7-8] + [9-11]
    o = mergeLessonWithNext(o, 2, 0); // merge 1.2 Current [5-6] with 2.1 Resistors [7-8]
    const saved = await saveOutline(user.id, c.id, o);

    const u = saved.outline.units;
    expect(u[1].lessons.map((l) => [l.title, l.id])).toEqual([["1.1 What is charge?", basicsId]]);
    expect(u[2].lessons.map((l) => `${l.title} ${l.pageStart}-${l.pageEnd}`)).toEqual(["1.2 Current 5-8", "2.1 Resistors (continued) 9-11"]);
    // 2.1 Resistors' original row was merged away; its id is gone. The split half is a new row.
    expect(u[2].lessons.some((l) => l.id === resistorsId)).toBe(false);
    expect(await db.lesson.count({ where: { courseId: c.id } })).toBe(5);
  });

  it("marks a lesson PENDING again when its pages change", async () => {
    const { user, course: c } = await course();
    const { outline } = await getOutlineForEditing(user.id, c.id);
    const id = outline.units[1].lessons[0].id!;
    await db.lesson.update({ where: { id }, data: { status: "READY" } });
    await saveOutline(user.id, c.id, renameLesson(outline, 1, 0, "Renamed only"));
    expect((await db.lesson.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
    const again = await getOutlineForEditing(user.id, c.id);
    await saveOutline(user.id, c.id, setLessonRange(again.outline, 1, 0, 3, 5));
    expect((await db.lesson.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });

  it("deletes removed lessons and empty units", async () => {
    const { user, course: c } = await course();
    const { outline } = await getOutlineForEditing(user.id, c.id);
    await saveOutline(user.id, c.id, deleteLesson(outline, 2, 0));
    expect(await db.unit.count({ where: { courseId: c.id } })).toBe(3);
    expect(await db.lesson.count({ where: { courseId: c.id } })).toBe(4);
  });

  it("'Reset to detected' reuses ids of identical lessons", async () => {
    const { user, course: c } = await course();
    const { outline, detected } = await getOutlineForEditing(user.id, c.id);
    const basicsId = outline.units[1].lessons[0].id!;
    const saved = await saveOutline(user.id, c.id, detected!);
    expect(saved.outline.units[1].lessons[0]).toMatchObject({ title: "1.1 Basics", id: basicsId });
    expect(saved.outline.units).toHaveLength(2);
  });

  it("rejects invalid outlines without changing anything", async () => {
    const { user, course: c } = await course();
    const { outline } = await getOutlineForEditing(user.id, c.id);
    const bad = setLessonRange(outline, 1, 0, 3, 99);
    await expect(saveOutline(user.id, c.id, bad)).rejects.toBeInstanceOf(OutlineInvalidError);
    await expect(saveOutline(user.id, c.id, { units: "nope" })).rejects.toBeInstanceOf(OutlineInvalidError);
    expect((await db.lesson.findFirstOrThrow({ where: { title: "1.1 Basics" } })).pageEnd).toBe(4);
  });

  it("can't be edited while the book is still processing", async () => {
    const { user, course: c } = await course("PROCESSING");
    const { outline } = await getOutlineForEditing(user.id, c.id);
    await expect(saveOutline(user.id, c.id, outline)).rejects.toBeInstanceOf(OutlineLockedError);
  });
});

describe("privacy", () => {
  it("another user can't read or save someone's outline, settings or pages", async () => {
    const { user, course: c } = await course();
    const intruder = await createUser("Intruder");
    const { outline } = await getOutlineForEditing(user.id, c.id);
    await expect(getOutlineForEditing(intruder.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveOutline(intruder.id, c.id, outline)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveSettings(intruder.id, c.id, DEFAULT_SETTINGS)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPagePreview(intruder.id, c.id, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ids from another course in a saved outline are treated as new, never touched", async () => {
    const a = await course();
    const b = await course();
    const other = await getOutlineForEditing(b.user.id, b.course.id);
    const foreignId = other.outline.units[1].lessons[0].id!;
    const mine = await getOutlineForEditing(a.user.id, a.course.id);
    mine.outline.units[1].lessons[0].id = foreignId; // tampered request
    await saveOutline(a.user.id, a.course.id, mine.outline);
    // B's lesson is untouched and still belongs to B.
    const untouched = await db.lesson.findUniqueOrThrow({ where: { id: foreignId } });
    expect(untouched.courseId).toBe(b.course.id);
    expect(untouched.title).toBe("1.1 Basics");
  });
});

describe("settings", () => {
  it("defaults, saves, and toggling front/back matter includes or skips those lessons", async () => {
    const { user, course: c } = await course();
    expect(await getSettings(user.id, c.id)).toEqual(DEFAULT_SETTINGS);
    await saveSettings(user.id, c.id, { ...DEFAULT_SETTINGS, level: "college", includeFrontBackMatter: true });
    expect((await getSettings(user.id, c.id)).level).toBe("college");
    expect(await db.lesson.count({ where: { courseId: c.id, skip: true } })).toBe(0);
    await saveSettings(user.id, c.id, { ...DEFAULT_SETTINGS, includeFrontBackMatter: false });
    expect(await db.lesson.count({ where: { courseId: c.id, skip: true } })).toBe(2);
  });

  it("rejects invalid settings", async () => {
    const { user, course: c } = await course();
    await expect(saveSettings(user.id, c.id, { ...DEFAULT_SETTINGS, level: "kindergarten" })).rejects.toBeInstanceOf(OutlineInvalidError);
  });

  it("estimate inputs count text and equation-heavy pages per included lesson", async () => {
    const { user, course: c } = await course();
    const inputs = await getEstimateInputs(user.id, c.id);
    expect(inputs.normal).toHaveLength(3);
    expect(inputs.frontBack).toHaveLength(2);
    const resistors = inputs.normal[2];
    expect(resistors).toMatchObject({ pages: 5, chars: 2000, mathHeavyPages: 1 });
  });
});

describe("getPagePreview", () => {
  it("returns the first and last words of a page", async () => {
    const { user, course: c } = await course();
    const p = await getPagePreview(user.id, c.id, 3);
    expect(p.start.startsWith("Page 3 text.")).toBe(true);
    expect(p.end.endsWith("Page 3 text.")).toBe(true);
    await expect(getPagePreview(user.id, c.id, 13)).rejects.toBeInstanceOf(NotFoundError);
  });
});
