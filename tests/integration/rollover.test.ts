import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { startSemester } from "@/server/rollover";
import { createUser, resetDb } from "../helpers/db";

/** Semester rollover: fresh classes with the same staff and scopes, old ones archived, student history kept. */

const sent: { to: string; subject: string }[] = [];
vi.mock("@/server/email", () => ({ sendEmail: async (m: { to: string; subject: string }) => void sent.push(m) }));
beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

describe("semester rollover", () => {
  it("copies classes with staff, scopes and empty groups; archives the old; keeps scores; re-invites on request", async () => {
    const [admin, rw, ana, outsider] = await Promise.all(["Admin", "RW", "Ana", "Other"].map((n) => createUser(n)));
    const c = await createClass(admin.id, "SAT Math (Fall 2026)");
    const other = await createClass(admin.id, "Reading club");
    await db.classMember.create({ data: { classId: c.id, userId: ana.id } });
    const g = await createGroup(admin.id, c.id, "Group B", [ana.id]);
    await db.classStaff.create({ data: { classId: c.id, userId: rw.id, role: "SPECIALIST", sections: ["RW"], domains: [], groupIds: [g.id] } });
    await db.scoreRecord.create({ data: { studentId: ana.id, source: "PSAT", takenOn: new Date("2026-09-01T00:00:00Z"), total: 990, isBaseline: true, enteredById: ana.id } });
    const program = await db.program.findFirstOrThrow({ where: { adminId: admin.id } });

    await expect(startSemester(rw.id, program.id, { semester: "Spring 2027", classIds: [c.id], reinvite: false })).rejects.toBeInstanceOf(ClassError);
    await expect(startSemester(outsider.id, program.id, { semester: "Spring 2027", classIds: [c.id], reinvite: false })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startSemester(admin.id, program.id, { semester: " ", classIds: [c.id], reinvite: false })).rejects.toThrow(/Name the semester/);

    const r = await startSemester(admin.id, program.id, { semester: "Spring 2027", classIds: [c.id], reinvite: true });
    expect(r.created).toHaveLength(1);
    const fresh = await db.class.findUniqueOrThrow({ where: { id: r.created[0].id }, include: { staff: true, groups: { include: { members: true } }, members: true, invites: true } });
    expect(fresh.name).toBe("SAT Math (Spring 2027)");
    expect(fresh.joinCode).not.toBe(c.joinCode);
    expect(fresh.members).toHaveLength(0);
    expect(fresh.groups.map((x) => x.name)).toEqual(["Group B"]);
    expect(fresh.groups[0].members).toHaveLength(0);
    const spec = fresh.staff.find((s) => s.userId === rw.id)!;
    expect(spec).toMatchObject({ role: "SPECIALIST", sections: ["RW"], groupIds: [fresh.groups[0].id] });
    expect(fresh.staff.find((s) => s.userId === admin.id)?.role).toBe("TEACHER");
    expect(fresh.invites.map((i) => i.email)).toEqual([ana.email.toLowerCase()]);
    expect(sent.map((m) => m.to)).toEqual([ana.email.toLowerCase()]);
    // Old class archived, the other class untouched, Ana's history kept.
    expect((await db.class.findUniqueOrThrow({ where: { id: c.id } })).archivedAt).not.toBeNull();
    expect((await db.class.findUniqueOrThrow({ where: { id: other.id } })).archivedAt).toBeNull();
    expect(await db.scoreRecord.count({ where: { studentId: ana.id } })).toBe(1);
    expect(await db.classMember.count({ where: { classId: c.id, userId: ana.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { programId: program.id, action: "program.semester" } })).toBe(1);
    // An archived class can't be carried forward again.
    await expect(startSemester(admin.id, program.id, { semester: "Summer 2027", classIds: [c.id], reinvite: false })).rejects.toThrow(/aren't active/);
  });
});
