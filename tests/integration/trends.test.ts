import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { classTrends, lastMonths, programTrends } from "@/server/trends";
import { createUser, resetDb } from "../helpers/db";

/** Comparison charts: averages only, inside each viewer's scope; program comparisons for the admin only. */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);

const NOW = new Date("2026-11-10T12:00:00Z");

async function fixture() {
  const [admin, teacher, math, rwB, viewer, ana, cal] = await Promise.all(["Admin", "Teacher", "Math", "RW B", "Viewer", "Ana", "Cal"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gA = await createGroup(admin.id, c.id, "Group A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "Group B", [cal.id]);
  await db.classStaff.createMany({
    data: [
      { classId: c.id, userId: teacher.id, role: "TEACHER", sections: [], domains: [], groupIds: [] },
      { classId: c.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"], domains: [], groupIds: [] },
      { classId: c.id, userId: rwB.id, role: "SPECIALIST", sections: ["RW"], domains: [], groupIds: [gB.id] },
      { classId: c.id, userId: viewer.id, role: "VIEWER", sections: [], domains: [], groupIds: [] },
    ],
  });
  const score = (studentId: string, takenOn: string, total: number, isBaseline = false) =>
    db.scoreRecord.create({ data: { studentId, source: "PRACTICE_BLUEBOOK", takenOn: new Date(`${takenOn}T00:00:00Z`), total, rw: total / 2, math: total / 2, isBaseline, enteredById: studentId } });
  await score(ana.id, "2026-09-05", 1000, true);
  await score(ana.id, "2026-10-05", 1100);
  await score(cal.id, "2026-09-07", 900, true);
  await score(cal.id, "2026-10-07", 960);
  return { admin, teacher, math, rwB, viewer, ana, cal, c, gA, gB };
}

describe("comparison charts", () => {
  it("averages groups by month inside the viewer's scope", async () => {
    const f = await fixture();
    const t = await classTrends(f.teacher.id, f.c.id, NOW);
    expect(t.months).toEqual(lastMonths(NOW));
    const at = (name: string, m: string) => t.groups.find((g) => g.name === name)!.values[t.months.indexOf(m)];
    expect(at("Whole class", "2026-09")).toBe(950);
    expect(at("Group A", "2026-10")).toBe(1100);
    expect(at("Group B", "2026-10")).toBe(960);
    // Group-limited R&W specialist: only group B, and the R&W section score.
    const rw = await classTrends(f.rwB.id, f.c.id, NOW);
    expect(rw.metric).toBe("rw");
    expect(rw.groups.map((g) => g.name)).toEqual(["Your students", "Group B"]);
    expect(rw.groups[0].values[rw.months.indexOf("2026-10")]).toBe(480);
    expect(rw.domains.map((d) => d.name).every((n) => !/Algebra|Geometry/.test(n))).toBe(true);
    // Math specialist: math domains only.
    const math = await classTrends(f.math.id, f.c.id, NOW);
    expect(math.domains).toHaveLength(4);
    await expect(classTrends(f.ana.id, f.c.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("compares classes and teachers for the program admin only", async () => {
    const f = await fixture();
    const program = await db.program.findFirstOrThrow({ where: { adminId: f.admin.id } });
    const p = await programTrends(f.admin.id, program.id, NOW);
    expect(p.classes[0].values[p.months.indexOf("2026-10")]).toBe(1030);
    // Average gain: Ana +100, Cal +60 → +80, for both the admin (class creator) and the teacher.
    expect(p.teachers.find((t) => t.label === "Teacher")).toEqual({ label: "Teacher", value: 80, n: 2 });
    for (const u of [f.teacher, f.math, f.viewer, f.ana]) await expect(programTrends(u.id, program.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });
});
