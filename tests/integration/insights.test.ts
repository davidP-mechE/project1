import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import * as tracker from "@/server/tracker";
import { redoCsv, redoList, setRedoStatus, studentInsights } from "@/server/insights";
import { ensureReferenceData, SEED_TESTS } from "@/server/seed/reference";
import { createUser, resetDb } from "../helpers/db";

const ALG = "math.algebra.linear-equations-in-one-variable";
const PCT = "math.psda.percentages";
const WIC = "rw.craft-structure.words-in-context";
type R = "wrong" | "skipped" | "guessed";
const it_ = (section: "rw" | "math", module: number, n: number, result: R, skillId: string, errorTypeId: string): tracker.ItemInput => ({ section, module, questionNumber: n, result, skillId, errorTypeId });

async function log(userId: string, date: string, rw: number, math: number, items: tracker.ItemInput[], finish = true) {
  const a = await tracker.startAttempt(userId, { testId: SEED_TESTS[0].id, dateTaken: date });
  await tracker.saveAttempt(userId, a.id, { scoreRw: rw, scoreMath: math, items });
  if (finish) await tracker.completeAttempt(userId, a.id);
  return a.id;
}

/**
 * Hand count for the sample below (four finished logs, one draft that must not count):
 *
 *   Z  Jul 1  1000  PCT wrong ×3 (careless ×3)
 *   A  Aug 1  1100  WIC wrong careless, WIC wrong concept-gap, ALG wrong careless
 *   B  Sep 1  1200  WIC guessed guessed, ALG skipped time, PCT wrong concept-gap
 *   C  Oct 1  1250  ALG wrong careless, ALG wrong concept-gap, WIC wrong careless
 *   D  Oct 5  draft PCT wrong ×5 (ignored)
 *
 *   Misses by skill:  ALG 4 (careless 2 = 50%, concept 1 = 25%)
 *                     PCT 4 (careless 3 = 75%, concept 1 = 25%)
 *                     WIC 4 (careless 2 = 50%, concept 1 = 25%)
 *   Coursebook practice: ALG 2 answered, 1 wrong (so ALG ranks first on the tie).
 *   Focus next (last 3 = A, B, C): ALG 4, WIC 4, PCT 1.
 *   Totals: 4 logs, 12 misses. C's error mix: careless 2, concept-gap 1.
 */
describe("insights match a hand count", () => {
  beforeEach(async () => {
    await resetDb();
    await ensureReferenceData({ onlyIfEmpty: false });
  });

  it("score trend, misses by skill, error mix, focus next", async () => {
    const s = await createUser("Student");
    const Z = await log(s.id, "2026-07-01", 500, 500, [it_("math", 1, 1, "wrong", PCT, "careless"), it_("math", 1, 2, "wrong", PCT, "careless"), it_("math", 2, 3, "wrong", PCT, "careless")]);
    const A = await log(s.id, "2026-08-01", 550, 550, [it_("rw", 1, 1, "wrong", WIC, "careless"), it_("rw", 1, 2, "wrong", WIC, "concept-gap"), it_("math", 1, 3, "wrong", ALG, "careless")]);
    const B = await log(s.id, "2026-09-01", 600, 600, [it_("rw", 2, 4, "guessed", WIC, "guessed"), it_("math", 1, 5, "skipped", ALG, "time"), it_("math", 2, 6, "wrong", PCT, "concept-gap")]);
    const C = await log(s.id, "2026-10-01", 620, 630, [it_("math", 2, 7, "wrong", ALG, "careless"), it_("math", 2, 8, "wrong", ALG, "concept-gap"), it_("rw", 1, 9, "wrong", WIC, "careless")]);
    await log(s.id, "2026-10-05", 700, 700, [1, 2, 3, 4, 5].map((n) => it_("math", 1, n, "wrong", PCT, "careless")), false);
    // Coursebook practice: two answers on an ALG question, one wrong.
    const q = await db.bankQuestion.create({ data: { section: "math", skillId: ALG, type: "mcq", stem: "x", choices: ["1", "2", "3", "4"], answer: "A", status: "published" } });
    await db.bankAttempt.createMany({ data: [{ userId: s.id, questionId: q.id, questionVersion: 1, answerGiven: "A", correct: true }, { userId: s.id, questionId: q.id, questionVersion: 1, answerGiven: "B", correct: false }] });

    const d = await studentInsights(s.id);
    expect(d.trend.map((t) => [t.id, t.total, t.rw, t.math])).toEqual([
      [Z, 1000, 500, 500],
      [A, 1100, 550, 550],
      [B, 1200, 600, 600],
      [C, 1250, 620, 630],
    ]);
    expect(d.totals).toEqual({ logs: 4, misses: 12 });
    expect(d.bySkill.map((r) => [r.skillId, r.misses, r.careless, r.conceptGap, r.carelessShare, r.conceptShare, r.practiceAnswered, r.practiceWrong])).toEqual([
      [ALG, 4, 2, 1, 0.5, 0.25, 2, 1],
      [PCT, 4, 3, 1, 0.75, 0.25, 0, 0],
      [WIC, 4, 2, 1, 0.5, 0.25, 0, 0],
    ]);
    expect(d.focus.map((f) => [f.skillId, f.misses])).toEqual([
      [ALG, 4],
      [WIC, 4],
      [PCT, 1],
    ]);
    expect(d.errorTrend.find((t) => t.id === C)!.counts).toMatchObject({ careless: 2, "concept-gap": 1, guessed: 0, time: 0 });
    expect(d.errorTrend.find((t) => t.id === B)!.counts).toMatchObject({ guessed: 1, time: 1, "concept-gap": 1 });
    expect(d.practice).toEqual({ answered: 2, correct: 1 });
  });

  it("links focus skills to the published public set with the most questions on that skill", async () => {
    const s = await createUser("Student");
    await log(s.id, "2026-10-01", 600, 600, [it_("math", 1, 1, "wrong", PCT, "careless")]);
    const mk = (skillId: string) => db.bankQuestion.create({ data: { section: "math", skillId, type: "mcq", stem: "x", choices: ["1", "2", "3", "4"], answer: "A", status: "published" }, select: { id: true } });
    const p1 = await mk(PCT);
    const p2 = await mk(PCT);
    const a1 = await mk(ALG);
    await db.questionSet.create({ data: { title: "Mixed", questionIds: [p1.id, a1.id], skillIds: [PCT, ALG], status: "published", visibility: "public" } });
    const best = await db.questionSet.create({ data: { title: "Percent drill", questionIds: [p1.id, p2.id], skillIds: [PCT], status: "published", visibility: "public" } });
    await db.questionSet.create({ data: { title: "Draft", questionIds: [p1.id, p2.id], skillIds: [PCT], status: "draft", visibility: "public" } });
    const d = await studentInsights(s.id);
    expect(d.focus[0].set).toMatchObject({ id: best.id, title: "Percent drill" });
  });

  it("redo list: every miss with test, module and number; statuses; filters; CSV; owner only", async () => {
    const s = await createUser("Student");
    const other = await createUser("Other");
    await log(s.id, "2026-10-01", 600, 600, [it_("math", 2, 14, "wrong", ALG, "careless"), it_("rw", 1, 3, "guessed", WIC, "guessed")]);
    await log(s.id, "2026-10-05", 600, 600, [it_("rw", 1, 7, "skipped", WIC, "time")], false);
    const all = await redoList(s.id);
    expect(all).toHaveLength(3);
    const alg = all.find((r) => r.questionNumber === 14)!;
    expect(alg).toMatchObject({ section: "math", module: 2, redoStatus: "to_redo", attempt: { test: { name: "Bluebook Practice Test 4" } } });
    await setRedoStatus(s.id, alg.id, "redone_correct");
    await expect(setRedoStatus(other.id, alg.id, "still_wrong")).rejects.toBeInstanceOf(NotFoundError);
    expect(await redoList(s.id, { status: "redone_correct" })).toHaveLength(1);
    expect(await redoList(s.id, { skillId: WIC })).toHaveLength(2);
    expect(await redoList(s.id, { errorTypeId: "guessed" })).toHaveLength(1);
    expect(await redoList(other.id)).toHaveLength(0);
    const csv = await redoCsv(s.id, { skillId: ALG });
    expect(csv).toContain("Bluebook Practice Test 4,2026-10-01,Math,2,14,wrong,Linear equations in one variable,Careless,,Redone (correct)");
  });
});
