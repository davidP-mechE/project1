import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import * as tracker from "@/server/tracker";
import { ensureReferenceData, SEED_TESTS } from "@/server/seed/reference";
import { createUser, resetDb } from "../helpers/db";

const T4 = SEED_TESTS[0].id;
const ALG = "math.algebra.linear-equations-in-one-variable";
const WIC = "rw.craft-structure.words-in-context";
const miss = (section: "rw" | "math", module: number, n: number, extra: Partial<tracker.ItemInput> = {}): tracker.ItemInput => ({ section, module, questionNumber: n, result: "wrong", skillId: section === "rw" ? WIC : ALG, errorTypeId: "careless", ...extra });

describe("practice-test tracker", () => {
  // Truncating users cascades to the practice-test table, so the catalog is re-seeded each time.
  beforeEach(async () => {
    await resetDb();
    await ensureReferenceData({ onlyIfEmpty: false });
  });
  afterAll(async () => {
    await db.practiceTest.deleteMany({ where: { createdById: { not: null } } });
  });

  it("logs a test across sessions and completes it once every miss is tagged", async () => {
    const s = await createUser("Student");
    const a = await tracker.startAttempt(s.id, { testId: T4, dateTaken: "2026-10-04" });
    // First sitting: two misses, one not tagged yet.
    await tracker.saveAttempt(s.id, a.id, { items: [miss("rw", 1, 5), { section: "math", module: 2, questionNumber: 14, result: "guessed" }] });
    await expect(tracker.completeAttempt(s.id, a.id)).rejects.toThrow(/Math M2 #14/);
    // Later: scores and the missing tag.
    await tracker.saveAttempt(s.id, a.id, { scoreRw: 640, scoreMath: 700, items: [miss("rw", 1, 5), miss("math", 2, 14, { result: "guessed", errorTypeId: "guessed" })] });
    const done = await tracker.completeAttempt(s.id, a.id);
    expect(done.status).toBe("complete");
    expect(done.total).toBe(1340);
    const sr = await db.scoreRecord.findUniqueOrThrow({ where: { testAttemptId: a.id } });
    expect(sr).toMatchObject({ source: "PRACTICE_BLUEBOOK", total: 1340, rw: 640, math: 700, testName: "Bluebook Practice Test 4", isBaseline: true });
    expect(sr.missed).toEqual([
      { section: "RW", module: 1, number: 5, domain: "craft-structure", skill: "Words in context", reason: "wrong" },
      { section: "MATH", module: 2, number: 14, domain: "algebra", skill: "Linear equations in one variable", reason: "guessed" },
    ]);
  });

  it("keeps redo progress when a log is re-saved, and removes cells set back to correct", async () => {
    const s = await createUser("Student");
    const a = await tracker.startAttempt(s.id, { testId: T4, dateTaken: "2026-10-04" });
    await tracker.saveAttempt(s.id, a.id, { items: [miss("rw", 1, 5), miss("rw", 1, 6)] });
    await db.attemptItem.updateMany({ where: { attemptId: a.id, questionNumber: 5 }, data: { redoStatus: "redone_correct" } });
    await tracker.saveAttempt(s.id, a.id, { items: [miss("rw", 1, 5, { note: "rushed" })] });
    const items = await db.attemptItem.findMany({ where: { attemptId: a.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ questionNumber: 5, redoStatus: "redone_correct", note: "rushed" });
  });

  it("an untagged miss on a finished log puts it back to draft", async () => {
    const s = await createUser("Student");
    const a = await tracker.startAttempt(s.id, { testId: T4, dateTaken: "2026-10-04" });
    await tracker.saveAttempt(s.id, a.id, { total: 1200, items: [miss("rw", 1, 5)] });
    await tracker.completeAttempt(s.id, a.id);
    const again = await tracker.saveAttempt(s.id, a.id, { items: [miss("rw", 1, 5), { section: "rw", module: 1, questionNumber: 9, result: "wrong" }] });
    expect(again.status).toBe("draft");
    expect(await db.scoreRecord.count({ where: { testAttemptId: a.id } })).toBe(0);
  });

  it("validates question numbers, sections, skills and scores", async () => {
    const s = await createUser("Student");
    const a = await tracker.startAttempt(s.id, { testId: T4, dateTaken: "2026-10-04" });
    await expect(tracker.saveAttempt(s.id, a.id, { items: [miss("math", 1, 23)] })).rejects.toThrow(/1 to 22/);
    await expect(tracker.saveAttempt(s.id, a.id, { items: [miss("math", 3, 1)] })).rejects.toThrow(/module/);
    await expect(tracker.saveAttempt(s.id, a.id, { items: [miss("math", 1, 2, { skillId: WIC })] })).rejects.toThrow(/same section/);
    await expect(tracker.saveAttempt(s.id, a.id, { scoreRw: 655 })).rejects.toThrow(/steps of 10/);
    await expect(tracker.saveAttempt(s.id, a.id, { scoreRw: 600, scoreMath: 600, total: 1300 })).rejects.toThrow(/should be 1200/);
    await expect(tracker.startAttempt(s.id, { testId: T4, dateTaken: "2099-01-01" })).rejects.toThrow(/future/);
  });

  it("a student's custom test and logs are theirs alone", async () => {
    const s = await createUser("Student");
    const other = await createUser("Other");
    const t = await tracker.createTest(s.id, { name: "My paper test", source: "paper", modules: [{ section: "math", number: 1, question_count: 22 }] });
    expect(t.shared).toBe(false);
    expect((await tracker.listTests(other.id)).some((x) => x.id === t.id)).toBe(false);
    await expect(tracker.startAttempt(other.id, { testId: t.id, dateTaken: "2026-10-01" })).rejects.toBeInstanceOf(NotFoundError);
    const a = await tracker.startAttempt(s.id, { testId: t.id, dateTaken: "2026-10-01" });
    await expect(tracker.getAttempt(other.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(tracker.saveAttempt(other.id, a.id, { notes: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(tracker.deleteAttempt(other.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("tests added by a tutor are shared", async () => {
    const tutor = await createUser("Tutor");
    await db.user.update({ where: { id: tutor.id }, data: { role: "TUTOR" } });
    const t = await tracker.createTest(tutor.id, { name: "Shared test", modules: [{ section: "rw", number: 1, question_count: 27 }] });
    expect(t.shared).toBe(true);
  });
});
