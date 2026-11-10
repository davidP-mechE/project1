import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass, classProgress } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { addScore, baselineStatus, classScores, deleteScore, myScores, programDashboard, setProfile, studentScoresForStaff, updateScore, verifyScore } from "@/server/scores";
import { assignExternal, getExternalAssignment, isCollegeBoardUrl, recordExternal } from "@/server/external";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);

const CB = "https://satsuitequestionbank.collegeboard.org/digital/results";

async function outcome(fn: () => Promise<unknown>): Promise<"ok" | "denied" | "hidden" | "invalid"> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (err instanceof NotFoundError) return "hidden";
    if (err instanceof ClassError) return err.status === 403 ? "denied" : "invalid";
    throw err;
  }
}

async function fixture() {
  const [admin, teacher, math, rwB, viewer, outsider, ana, ben, cal, dee] = await Promise.all(["Admin", "Teacher", "Math", "RW B", "Viewer", "Outsider", "Ana", "Ben", "Cal", "Dee"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal, dee]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const groupB = await createGroup(admin.id, c.id, "B", [cal.id, dee.id]);
  await db.classStaff.createMany({
    data: [
      { classId: c.id, userId: teacher.id, role: "TEACHER" },
      { classId: c.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"] },
      { classId: c.id, userId: rwB.id, role: "SPECIALIST", sections: ["RW"], groupIds: [groupB.id] },
      { classId: c.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  await createClass(outsider.id, "Elsewhere");
  return { c, admin, teacher, math, rwB, viewer, outsider, ana, ben, cal, dee };
}

describe("scores", () => {
  it("students enter their own baseline and scores; the first one is the baseline", async () => {
    const { ana } = await fixture();
    expect(await baselineStatus(ana.id)).toEqual({ needed: true, pending: false });
    await setProfile(ana.id, { baselinePending: true });
    expect(await baselineStatus(ana.id)).toEqual({ needed: true, pending: true });
    await addScore(ana.id, ana.id, { source: "PSAT", takenOn: "2026-09-10", total: 970, rw: 500, math: 470 });
    await addScore(ana.id, ana.id, { source: "PRACTICE_BLUEBOOK", takenOn: "2026-10-20", testName: "Practice Test 4", total: 1060, missed: [{ section: "MATH", module: 2, number: 14, domain: "advanced-math", reason: "CONCEPT" }] });
    const h = await myScores(ana.id, new Date("2026-11-10"));
    expect(h.baseline).toMatchObject({ total: 970 });
    expect(h.latest).toMatchObject({ total: 1060 });
    expect(h.scores.map((s) => s.isBaseline)).toEqual([true, false]);
    expect(h.projection).not.toBeNull();
    expect(h.baselinePending).toBe(false);
    expect((await baselineStatus(ana.id)).needed).toBe(false);
  });

  it("refuses impossible scores, future dates and question content", async () => {
    const { ana } = await fixture();
    await expect(addScore(ana.id, ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1605 })).rejects.toThrow();
    await expect(addScore(ana.id, ana.id, { source: "SAT", takenOn: "2099-10-01", total: 1000 })).rejects.toThrow("future");
    await expect(addScore(ana.id, ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000, questionText: "If 2x = 4…" })).rejects.toThrow("not question content");
    await expect(addScore(ana.id, ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000, missed: [{ section: "MATH", module: 1, number: 3, domain: "algebra", prompt: "copy" }] })).rejects.toThrow();
    expect(await db.scoreRecord.count()).toBe(0);
  });

  it("students can't touch another student's scores; verified scores need staff", async () => {
    const { ana, ben, teacher, c } = await fixture();
    const id = await addScore(ana.id, ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000 });
    expect(await outcome(() => addScore(ben.id, ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1600 }))).toBe("hidden");
    expect(await outcome(() => updateScore(ben.id, id, { source: "SAT", takenOn: "2026-10-01", total: 1600 }))).toBe("hidden");
    expect(await outcome(() => deleteScore(ben.id, id))).toBe("hidden");
    await verifyScore(teacher.id, c.id, id);
    expect(await outcome(() => updateScore(ana.id, id, { source: "SAT", takenOn: "2026-10-01", total: 1100 }))).toBe("denied");
    expect(await outcome(() => updateScore(teacher.id, id, { source: "SAT", takenOn: "2026-10-01", total: 1100 }, { classId: c.id }))).toBe("ok");
    expect(await db.auditLog.count({ where: { action: { in: ["score.verify", "score.edit"] } } })).toBe(2);
  });

  it("staff see students in scope only; specialists see the total and their own sections", async () => {
    const f = await fixture();
    for (const s of [f.ana, f.cal]) {
      await addScore(s.id, s.id, { source: "PSAT", takenOn: "2026-09-10", total: 980, rw: 490, math: 490, missed: [{ section: "RW", module: 1, number: 2, domain: "info-ideas" }, { section: "MATH", module: 1, number: 9, domain: "algebra" }] });
    }
    const asMath = await studentScoresForStaff(f.math.id, f.c.id, f.ana.id);
    expect(asMath.scores[0]).toMatchObject({ total: 980, math: 490, rw: null });
    expect(asMath.scores[0].missed.map((m) => m.section)).toEqual(["MATH"]);
    expect(await outcome(() => studentScoresForStaff(f.rwB.id, f.c.id, f.ana.id))).toBe("hidden"); // not in group B
    const asRw = await studentScoresForStaff(f.rwB.id, f.c.id, f.cal.id);
    expect(asRw.scores[0]).toMatchObject({ rw: 490, math: null });
    expect(await outcome(() => studentScoresForStaff(f.outsider.id, f.c.id, f.ana.id))).toBe("hidden");
    expect(await outcome(() => studentScoresForStaff(f.ben.id, f.c.id, f.ana.id))).toBe("hidden");
    // Entering scores: teachers and specialists in scope; viewers can't; specialists only record misses in their subjects.
    expect(await outcome(() => addScore(f.viewer.id, f.ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000 }, { classId: f.c.id }))).toBe("denied");
    expect(await outcome(() => addScore(f.rwB.id, f.ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000 }, { classId: f.c.id }))).toBe("hidden");
    expect(await outcome(() => addScore(f.math.id, f.ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000, missed: [{ section: "RW", module: 1, number: 1, domain: "conventions" }] }, { classId: f.c.id }))).toBe("denied");
    expect(await outcome(() => addScore(f.math.id, f.ana.id, { source: "SAT", takenOn: "2026-10-01", total: 1000 }, { classId: f.c.id }))).toBe("ok");
    expect((await db.scoreRecord.findFirstOrThrow({ where: { enteredById: f.math.id } })).verifiedById).toBe(f.math.id);
  });

  it("the class Scores tab respects scope, and viewers of small groups see only aggregates", async () => {
    const f = await fixture();
    await addScore(f.ana.id, f.ana.id, { source: "PSAT", takenOn: "2026-09-10", total: 970 });
    await addScore(f.ana.id, f.ana.id, { source: "SAT", takenOn: "2026-10-30", total: 1150 });
    expect((await classScores(f.teacher.id, f.c.id)).students!.map((s) => s.name)).toEqual(["Ana", "Ben", "Cal", "Dee"]);
    expect((await classScores(f.rwB.id, f.c.id)).students!.map((s) => s.name)).toEqual(["Cal", "Dee"]);
    const v = await classScores(f.viewer.id, f.c.id);
    expect(v.students).toBeNull(); // 4 students: aggregates only
    expect(v.stats).toMatchObject({ students: 4, withBaseline: 1, missingBaseline: 3, averageGain: 180 });
    expect(await outcome(() => classScores(f.outsider.id, f.c.id))).toBe("hidden");
  });

  it("only the program admin sees the program dashboard", async () => {
    const f = await fixture();
    await addScore(f.ana.id, f.ana.id, { source: "PSAT", takenOn: "2026-09-10", total: 970 });
    await addScore(f.ana.id, f.ana.id, { source: "SAT", takenOn: "2026-10-30", total: 1270 });
    const d = await programDashboard(f.admin.id, f.c.programId);
    expect(d.stats).toMatchObject({ students: 4, averageGain: 300, onTrack: 1 });
    expect(d.trend).toEqual([
      { month: "2026-09", averageGain: 0, scores: 1 },
      { month: "2026-10", averageGain: 300, scores: 1 },
    ]);
    for (const who of [f.teacher, f.math, f.viewer, f.outsider, f.ana]) expect(await outcome(() => programDashboard(who.id, f.c.programId))).toBe("hidden");
  });
});

describe("College Board practice by link", () => {
  it("only accepts College Board links, an ID and a domain, never content", async () => {
    const { admin, c } = await fixture();
    expect(isCollegeBoardUrl(CB)).toBe(true);
    expect(isCollegeBoardUrl("https://collegeboard.org.evil.com/x")).toBe(false);
    expect(isCollegeBoardUrl("http://satsuitequestionbank.collegeboard.org/")).toBe(false);
    const ok = { questionId: "a1b2c3d4", url: CB, domain: "algebra" };
    expect(await outcome(() => assignExternal(admin.id, c.id, { title: "Bank", items: [{ ...ok, url: "https://example.com/q" }] }))).toBe("invalid");
    expect(await outcome(() => assignExternal(admin.id, c.id, { title: "Bank", items: [{ ...ok, prompt: "Solve 2x = 4" }] }))).toBe("invalid");
    expect(await outcome(() => assignExternal(admin.id, c.id, { title: "Bank", items: [ok, ok] }))).toBe("invalid");
    expect(await outcome(() => assignExternal(admin.id, c.id, { title: "Bank", items: [ok] }))).toBe("ok");
    const a = await db.assignment.findFirstOrThrow({ where: { kind: "EXTERNAL" } });
    expect(a).toMatchObject({ section: "MATH", domains: ["algebra"] });
    expect(Object.keys((a.externalItems as object[])[0]).sort()).toEqual(["domain", "key", "questionId", "section", "url"]);
  });

  it("specialists only assign in their subjects; viewers can't assign", async () => {
    const f = await fixture();
    const math = { questionId: "m1m1m1m1", url: CB, domain: "psda" };
    const rw = { questionId: "r1r1r1r1", url: CB, domain: "conventions" };
    expect(await outcome(() => assignExternal(f.math.id, f.c.id, { title: "x", items: [math] }))).toBe("ok");
    expect(await outcome(() => assignExternal(f.math.id, f.c.id, { title: "x", items: [rw] }))).toBe("denied");
    expect(await outcome(() => assignExternal(f.math.id, f.c.id, { title: "x", items: [math, rw] }))).toBe("denied");
    expect(await outcome(() => assignExternal(f.viewer.id, f.c.id, { title: "x", items: [math] }))).toBe("denied");
    expect(await outcome(() => assignExternal(f.outsider.id, f.c.id, { title: "x", items: [math] }))).toBe("hidden");
  });

  it("students record results on their own assignments; progress counts them", async () => {
    const f = await fixture();
    const a = await assignExternal(f.admin.id, f.c.id, { title: "Bank", items: [{ questionId: "a1a1a1a1", url: CB, domain: "algebra" }, { questionId: "a2a2a2a2", url: CB, domain: "algebra" }] });
    const view = await getExternalAssignment(f.ana.id, a.id);
    const [k1, k2] = view.items.map((i) => i.key);
    await recordExternal(f.ana.id, a.id, k1, { result: "INCORRECT", reason: "CONCEPT" });
    await recordExternal(f.ana.id, a.id, k1, { result: "CORRECT" }); // the latest counts
    await recordExternal(f.ana.id, a.id, k2, { result: "SKIPPED" });
    expect(await outcome(() => recordExternal(f.ana.id, a.id, k1, { result: "CORRECT", questionText: "x" }))).toBe("invalid");
    expect(await outcome(() => recordExternal(f.outsider.id, a.id, k1, { result: "CORRECT" }))).toBe("hidden");
    expect(await outcome(() => recordExternal(f.ana.id, a.id, "nope", { result: "CORRECT" }))).toBe("hidden");
    expect(await outcome(() => getExternalAssignment(f.outsider.id, a.id))).toBe("hidden");
    const grid = await classProgress(f.admin.id, f.c.id);
    expect(grid.cells[`${f.ana.id}:${a.id}`]).toMatchObject({ status: "done", done: 2, total: 2, score: 0.5 });
    expect(grid.cells[`${f.ben.id}:${a.id}`]).toMatchObject({ status: "not_started" });
  });
});
