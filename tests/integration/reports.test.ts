import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { classSummaryReport, myProgressReport, staffProgressReport } from "@/server/reports";
import { createUser, resetDb } from "../helpers/db";

/** Printable reports are scoped like the screens they come from. */

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
  await db.scoreRecord.create({ data: { studentId: ana.id, source: "PSAT", takenOn: new Date("2026-09-01T00:00:00Z"), total: 990, rw: 500, math: 490, isBaseline: true, enteredById: ana.id } });
  await db.mistakeItem.createMany({
    data: [
      { studentId: ana.id, sourceType: "SCORE", sourceId: "s1", label: "Q1", domain: "algebra", section: "MATH", due: new Date() },
      { studentId: ana.id, sourceType: "SCORE", sourceId: "s2", label: "Q2", domain: "craft-structure", section: "RW", due: new Date() },
    ],
  });
  return { admin, math, rwB, viewer, ana, cal, outsider, c };
}

describe("printable reports", () => {
  it("gives a student their own report", async () => {
    const f = await fixture();
    const r = await myProgressReport(f.ana.id);
    expect(r.studentName).toBe("Ana");
    expect(r.history.baseline?.total).toBe(990);
    expect(r.mistakes.map((m) => m.open)).toEqual([1, 1]);
    expect(r.domains).toHaveLength(8);
  });

  it("gives staff reports only for students in their scope, in their subjects", async () => {
    const f = await fixture();
    expect((await staffProgressReport(f.admin.id, f.c.id, f.ana.id)).studentName).toBe("Ana");
    const math = await staffProgressReport(f.math.id, f.c.id, f.ana.id);
    expect(math.domains.map((d) => d.domain).sort()).toEqual(["advanced-math", "algebra", "geo-trig", "psda"]);
    expect(math.mistakes).toEqual([{ name: "Algebra", open: 1 }]);
    expect(math.subjectsNote).toMatch(/subjects you cover/);
    await expect(staffProgressReport(f.rwB.id, f.c.id, f.ana.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffProgressReport(f.outsider.id, f.c.id, f.ana.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(staffProgressReport(f.cal.id, f.c.id, f.ana.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("summarizes a class in the viewer's scope", async () => {
    const f = await fixture();
    expect((await classSummaryReport(f.admin.id, f.c.id)).stats.students).toBe(2);
    const rw = await classSummaryReport(f.rwB.id, f.c.id);
    expect(rw.stats.students).toBe(1);
    expect(rw.scoped).toBe(true);
    expect(rw.domains).toHaveLength(4);
    await expect(classSummaryReport(f.outsider.id, f.c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(classSummaryReport(f.ana.id, f.c.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
