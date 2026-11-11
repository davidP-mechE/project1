import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { ClassError, classAccess } from "@/server/access";
import { createClass, joinClass, myClasses } from "@/server/classes";
import { addStaff } from "@/server/staff";
import { createProgram, studentPrograms } from "@/server/programs";
import { createUpload } from "@/server/courses";
import { AccessDeniedError, AccessRuleError, courseAccessWhere, programAccess, rulesForEmail, setAccessRule } from "@/server/program-access";
import { createUser, resetDb } from "../helpers/db";

/**
 * Admin → Program access: an email limited to one program ("only"), or kept
 * out of one ("blocked"). The fixture: The 1600 Project (run by `admin`) and
 * another program (run by `other`), one class in each.
 */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

beforeEach(async () => {
  await resetDb();
});

async function fixture() {
  const [siteAdmin, admin, other, student] = await Promise.all(["Site Admin", "1600 Admin", "Other Admin", "Student"].map((n) => createUser(n)));
  await db.user.update({ where: { id: siteAdmin.id }, data: { role: "ADMIN" } });
  const p1600 = await createProgram(admin.id, "The 1600 Project");
  const otherProgram = await createProgram(other.id, "Other Tutoring");
  const sat = await createClass(admin.id, "SAT Fall", p1600.id);
  const elsewhere = await createClass(other.id, "Algebra Club", otherProgram.id);
  return { siteAdmin, admin, other, student, p1600, otherProgram, sat, elsewhere };
}

describe("program access rules", () => {
  it("'only this program': joins only that program, and can't use the rest of Coursebook", async () => {
    const f = await fixture();
    await setAccessRule(f.siteAdmin.id, { email: f.student.email.toUpperCase(), programId: f.p1600.id, mode: "ONLY" });

    await expect(joinClass(f.student.id, f.elsewhere.joinCode)).rejects.toThrow(/set up for The 1600 Project only/);
    await expect(joinClass(f.student.id, f.sat.joinCode)).resolves.toBe(f.sat.id);
    expect((await myClasses(f.student.id)).map((c) => c.id)).toEqual([f.sat.id]);

    await expect(createUpload(f.student.id, { filename: "book.pdf", size: 1000, contentType: "application/pdf", rightsConfirmed: true })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(createProgram(f.student.id, "My own program")).rejects.toBeInstanceOf(ClassError);
    // Their own courses stay in the database but are out of reach.
    expect(courseAccessWhere(await programAccess(f.student.id))).toEqual({ classCourse: { class: { programId: { in: [f.p1600.id] } } } });
  });

  it("'blocked from this program': can't join, be added to or see it; other programs are fine", async () => {
    const f = await fixture();
    await db.classMember.create({ data: { classId: f.sat.id, userId: f.student.id } }); // joined before the rule
    await setAccessRule(f.siteAdmin.id, { email: f.student.email, programId: f.p1600.id, mode: "BLOCKED", note: "Left the program" });

    await expect(joinClass(f.student.id, f.sat.joinCode)).rejects.toThrow(/can't use this program/);
    expect(await myClasses(f.student.id)).toEqual([]);
    expect(await studentPrograms(f.student.id)).toEqual([]);
    await expect(joinClass(f.student.id, f.elsewhere.joinCode)).resolves.toBe(f.elsewhere.id);

    // Staff: can't be added, and loses access if already on the staff.
    const tutor = await createUser("Tutor");
    await db.classStaff.create({ data: { classId: f.sat.id, userId: tutor.id, role: "TEACHER" } });
    expect((await classAccess(tutor.id, f.sat.id)).role).toBe("TEACHER");
    await setAccessRule(f.siteAdmin.id, { email: tutor.email, programId: f.p1600.id, mode: "BLOCKED" });
    await expect(classAccess(tutor.id, f.sat.id)).rejects.toThrow(/Class not found/);
    const newcomer = await createUser("Newcomer");
    await setAccessRule(f.siteAdmin.id, { email: newcomer.email, programId: f.p1600.id, mode: "BLOCKED" });
    await expect(addStaff(f.admin.id, f.sat.id, newcomer.email, { role: "TEACHER" })).rejects.toThrow(/limited that account/);
  });

  it("applies to an email before sign-up, and one rule per email and program", async () => {
    const f = await fixture();
    await setAccessRule(f.siteAdmin.id, { email: " Future@Example.com ", programId: f.p1600.id, mode: "BLOCKED" });
    await setAccessRule(f.siteAdmin.id, { email: "future@example.com", programId: f.p1600.id, mode: "ONLY" });
    expect(await db.programAccessRule.count()).toBe(1);
    const rules = await rulesForEmail("future@example.com");
    expect([...rules.only]).toEqual([f.p1600.id]);
    expect(rules.blocked.size).toBe(0);
  });

  it("won't block a program's own admin or limit a site admin", async () => {
    const f = await fixture();
    await expect(setAccessRule(f.siteAdmin.id, { email: f.admin.email, programId: f.p1600.id, mode: "BLOCKED" })).rejects.toBeInstanceOf(AccessRuleError);
    await expect(setAccessRule(f.siteAdmin.id, { email: f.siteAdmin.email, programId: f.p1600.id, mode: "ONLY" })).rejects.toThrow(/Site admins/);
    await expect(setAccessRule(f.siteAdmin.id, { email: "not-an-email", programId: f.p1600.id, mode: "ONLY" })).rejects.toThrow(/valid email/);
  });
});
