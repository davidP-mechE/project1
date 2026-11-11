import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { addScore, updateScore } from "@/server/scores";
import { classWeakSpots, importScoreReports, myWeakSpots, studentWeakSpots } from "@/server/cb-results";
import { parseQuestionReview } from "@/lib/sat/cb-import";
import { createUser, resetDb } from "../helpers/db";

/** College Board results: entering them, importing a class's, and pinpointing weak spots, inside each person's scope. */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);

async function fixture() {
  const [admin, math, rwB, viewer, ana, cal, outsider] = await Promise.all(["Admin", "Math", "RW B", "Viewer", "Ana", "Cal", "Olly"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gB = await createGroup(admin.id, c.id, "Group B", [cal.id]);
  await db.classStaff.createMany({
    data: [
      { classId: c.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"], domains: [], groupIds: [] },
      { classId: c.id, userId: rwB.id, role: "SPECIALIST", sections: ["RW"], domains: [], groupIds: [gB.id] },
      { classId: c.id, userId: viewer.id, role: "VIEWER", sections: [], domains: [], groupIds: [] },
    ],
  });
  return { admin, math, rwB, viewer, ana, cal, outsider, c };
}

const REVIEW = ["Question\tSection\tModule\tContent Domain\tSkill\tResult\tQuestion Text", "1\tMath\t1\tGeometry and Trigonometry\tCircles\tIncorrect\tA circle has…", "2\tMath\t1\tGeometry and Trigonometry\tCircles\tIncorrect\t…", "3\tMath\t1\tAlgebra\tLinear functions\tCorrect\t…", "4\tReading and Writing\t1\tCraft and Structure\tWords in context\tCorrect\t…"].join("\n");

describe("entering College Board results", () => {
  it("stores bands and a question review (no question text), and the misses go to the mistake log", async () => {
    const f = await fixture();
    const review = parseQuestionReview(REVIEW).questions;
    const id = await addScore(f.ana.id, f.ana.id, { source: "PRACTICE_BLUEBOOK", takenOn: "2026-10-01", testName: "Bluebook Practice Test 4", total: 1100, domainBands: { "geo-trig": 2, algebra: 6 }, review });
    const row = await db.scoreRecord.findUniqueOrThrow({ where: { id } });
    expect(row.domainBands).toEqual({ "geo-trig": 2, algebra: 6 });
    expect((row.review as unknown[]).length).toBe(4);
    expect(JSON.stringify(row)).not.toMatch(/circle has/);
    expect(await db.mistakeItem.count({ where: { studentId: f.ana.id, sourceType: "SCORE" } })).toBe(2);
    await expect(addScore(f.ana.id, f.ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1100, domainBands: { algebra: 9 } })).rejects.toBeInstanceOf(ClassError);
    await expect(addScore(f.ana.id, f.ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1100, review: [{ ...review[0], prompt: "text" }] })).rejects.toThrow(/not question content|Unrecognized/);
  });

  it("keeps a subject-limited specialist to their subjects, and their edits don't wipe the other section", async () => {
    const f = await fixture();
    await expect(addScore(f.math.id, f.ana.id, { source: "PSAT", takenOn: "2026-10-01", total: 1000, domainBands: { "craft-structure": 3 } }, { classId: f.c.id })).rejects.toThrow(/your subjects/);
    const id = await addScore(f.admin.id, f.ana.id, { source: "PSAT", takenOn: "2026-10-01", total: 1000, domainBands: { "craft-structure": 3, algebra: 4 }, missed: [{ section: "RW", module: 1, number: 3, domain: "conventions" }] }, { classId: f.c.id });
    await updateScore(f.math.id, id, { source: "PSAT", takenOn: "2026-10-01", total: 1000, domainBands: { algebra: 5 }, missed: [] }, { classId: f.c.id });
    const row = await db.scoreRecord.findUniqueOrThrow({ where: { id } });
    expect(row.domainBands).toEqual({ "craft-structure": 3, algebra: 5 });
    expect(row.missed).toEqual([{ section: "RW", module: 1, number: 3, domain: "conventions" }]);
  });
});

describe("importing a class's score reports", () => {
  const CSV = ["Email,Test,Test date,Total score,Reading and Writing,Math,Algebra,Geometry and Trigonometry,Craft and Structure", "{ana},PSAT/NMSQT,10/15/2026,1010,520,490,3,2,5", "{cal},PSAT/NMSQT,10/15/2026,960,480,480,4,4,2", "{olly},PSAT/NMSQT,10/15/2026,900,450,450,,,", "bad-row,SAT,,100,,,,,"].join("\n");
  const csv = (f: Awaited<ReturnType<typeof fixture>>) => CSV.replace("{ana}", f.ana.email).replace("{cal}", f.cal.email).replace("{olly}", f.outsider.email);

  it("checks first, then adds rows for students in the class, once", async () => {
    const f = await fixture();
    const check = await importScoreReports(f.admin.id, f.c.id, csv(f), { dryRun: true });
    expect(check.rows.map((r) => r.status)).toEqual(["ready", "ready", "not in class", "error"]);
    expect(await db.scoreRecord.count()).toBe(0);
    const done = await importScoreReports(f.admin.id, f.c.id, csv(f));
    expect(done.added).toBe(2);
    const ana = await db.scoreRecord.findFirstOrThrow({ where: { studentId: f.ana.id } });
    expect(ana).toMatchObject({ source: "PSAT", total: 1010, rw: 520, math: 490, domainBands: { algebra: 3, "geo-trig": 2, "craft-structure": 5 } });
    expect(ana.verifiedById).toBe(f.admin.id);
    expect((await importScoreReports(f.admin.id, f.c.id, csv(f))).rows.slice(0, 2).map((r) => r.status)).toEqual(["already added", "already added"]);
    expect(await db.auditLog.count({ where: { action: "score.import" } })).toBe(1);
  });

  it("respects scope: group-limited staff reach their students only; subject bands outside scope are left out; viewers and outsiders can't import", async () => {
    const f = await fixture();
    const r = await importScoreReports(f.rwB.id, f.c.id, csv(f));
    expect(r.rows.map((x) => x.status)).toEqual(["not in class", "ready", "not in class", "error"]);
    const cal = await db.scoreRecord.findFirstOrThrow({ where: { studentId: f.cal.id } });
    expect(cal.domainBands).toEqual({ "craft-structure": 2 });
    expect(r.rows[1].notes[0]).toMatch(/outside your subjects/);
    await expect(importScoreReports(f.viewer.id, f.c.id, csv(f))).rejects.toBeInstanceOf(ClassError);
    await expect(importScoreReports(f.outsider.id, f.c.id, csv(f))).rejects.toBeInstanceOf(NotFoundError);
    await expect(importScoreReports(f.ana.id, f.c.id, csv(f))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("pinpointing weak spots", () => {
  it("ranks a student's weakest areas from bands and reviews, within each viewer's scope", async () => {
    const f = await fixture();
    const review = parseQuestionReview(REVIEW).questions;
    await addScore(f.admin.id, f.ana.id, { source: "PRACTICE_BLUEBOOK", takenOn: "2026-10-20", total: 1100, domainBands: { "geo-trig": 2, algebra: 6, "craft-structure": 6 }, review }, { classId: f.c.id });
    const mine = await myWeakSpots(f.ana.id);
    expect(mine.domains[0]).toMatchObject({ domain: "geo-trig", band: 2, cbRight: 0, cbTotal: 2 });
    expect(mine.skills[0]).toMatchObject({ skill: "Circles", missed: 2 });
    expect(mine.sources).toEqual({ reports: 1, reviews: 1 });
    const math = await studentWeakSpots(f.math.id, f.c.id, f.ana.id);
    expect(math.domains.every((d) => d.section === "MATH")).toBe(true);
    await expect(studentWeakSpots(f.rwB.id, f.c.id, f.ana.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(studentWeakSpots(f.outsider.id, f.c.id, f.ana.id)).rejects.toBeInstanceOf(NotFoundError);
    const cls = await classWeakSpots(f.admin.id, f.c.id);
    expect(cls).toMatchObject({ students: 2, withEvidence: 1 });
    expect(cls.rows[0]).toMatchObject({ domain: "geo-trig", weakestFor: 1, averageBand: 2 });
    const rw = await classWeakSpots(f.rwB.id, f.c.id);
    expect(rw.students).toBe(1);
    expect(rw.rows.every((r) => r.section === "RW")).toBe(true);
    await expect(classWeakSpots(f.ana.id, f.c.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
