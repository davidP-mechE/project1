import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { addScore } from "@/server/scores";
import { addGuardian } from "@/server/cohort";
import { recordError, reportProblem, scrub } from "@/server/monitoring";
import { deleteAccountCompletely, exportStudentForStaff, purgeStudentFromProgram, studentRecords } from "@/server/student-data";
import { backupKey, runBackup } from "@/server/backups";
import { toursToShow } from "@/server/tours";
import { assertNotProductionDatabase } from "@/server/env";
import { createUser, resetDb } from "../helpers/db";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email", () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }));
beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

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

describe("error monitoring", () => {
  it("removes personal details, groups repeats, and emails admins at most hourly", async () => {
    expect(scrub("Failed for ana@school.org with id 12345678 token=abc")).toBe("Failed for [email] with id [number] token=[hidden]");
    const admin = await createUser("Site admin");
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const t0 = new Date("2026-11-10T10:00:00Z");
    await recordError({ kind: "server", message: "Boom for ana@school.org", path: "/teach/cabc123def456ghi789jkl012/scores?group=x" }, t0);
    await recordError({ kind: "server", message: "Boom for ben@school.org", path: "/teach/czzz123def456ghi789jkl999/scores" }, new Date(t0.getTime() + 60_000));
    const rows = await db.errorEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, message: "Boom for [email]" });
    expect(rows[0].path).not.toContain("?");
    expect(sent.filter((m) => m.subject.startsWith("Coursebook error"))).toHaveLength(1);
    await recordError({ kind: "server", message: "Boom for x@y.org", path: "/teach/cabc123def456ghi789jkl012/scores" }, new Date(t0.getTime() + 61 * 60_000));
    expect(sent.filter((m) => m.subject.startsWith("Coursebook error"))).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toMatch(/ana@school|ben@school/);
  });

  it("problem reports keep the page and error ids, never form contents", async () => {
    const admin = await createUser("Site admin");
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await reportProblem(null, { path: "/scores?secret=1", userAgent: "Firefox", errorIds: ["e1"], note: "Chart is blank, email me at me@x.org" });
    const r = await db.problemReport.findFirstOrThrow();
    expect(r).toMatchObject({ path: "/scores", errorIds: ["e1"], note: "Chart is blank, email me at [email]" });
    expect(sent.at(-1)!.subject).toBe("Coursebook: a problem was reported");
  });
});

describe("student data export and deletion", () => {
  async function fixture() {
    const [admin, teacher, other, ana, siteAdmin] = await Promise.all(["Admin", "Teacher", "Other admin", "Ana", "Site"].map((n) => createUser(n)));
    await db.user.update({ where: { id: siteAdmin.id }, data: { role: "ADMIN" } });
    const c = await createClass(admin.id, "SAT Fall");
    const elsewhere = await createClass(other.id, "Other program");
    await db.classMember.create({ data: { classId: c.id, userId: ana.id } });
    await db.classStaff.create({ data: { classId: c.id, userId: teacher.id, role: "TEACHER" } });
    await addScore(ana.id, ana.id, { source: "PSAT", takenOn: "2026-09-01", total: 980 });
    await addGuardian(admin.id, c.id, ana.id, { name: "Mom", email: "mom@home.org", consent: true });
    return { admin, teacher, other, ana, siteAdmin, c, elsewhere };
  }

  it("exports the student's own records, and staff exports are scoped and audited", async () => {
    const f = await fixture();
    const mine = await studentRecords(f.ana.id);
    expect(mine.scores).toHaveLength(1);
    expect(mine.guardians[0]).toMatchObject({ email: "mom@home.org" });
    expect(await outcome(() => exportStudentForStaff(f.teacher.id, f.c.id, f.ana.id))).toBe("ok");
    expect(await outcome(() => exportStudentForStaff(f.other.id, f.c.id, f.ana.id))).toBe("hidden");
    expect(await outcome(() => exportStudentForStaff(f.ana.id, f.c.id, f.ana.id))).toBe("hidden");
    expect(await db.auditLog.count({ where: { action: "student.export" } })).toBe(1);
  });

  it("only the program admin deletes a student's program data; their own scores go if they have no other program", async () => {
    const f = await fixture();
    expect(await outcome(() => purgeStudentFromProgram(f.teacher.id, f.c.programId, f.ana.id, "Ana"))).toBe("hidden");
    expect(await outcome(() => purgeStudentFromProgram(f.admin.id, f.c.programId, f.ana.id, "wrong"))).toBe("invalid");
    await purgeStudentFromProgram(f.admin.id, f.c.programId, f.ana.id, "Ana");
    expect(await db.classMember.count({ where: { userId: f.ana.id } })).toBe(0);
    expect(await db.scoreRecord.count({ where: { studentId: f.ana.id } })).toBe(0);
    expect(await db.guardianContact.count({ where: { studentId: f.ana.id } })).toBe(0);
    expect(await db.user.count({ where: { id: f.ana.id } })).toBe(1); // the account itself stays
    expect(await db.auditLog.count({ where: { action: "student.purge" } })).toBe(1);
  });

  it("the site admin can delete a whole account; a program admin with people must hand over first", async () => {
    const f = await fixture();
    expect(await outcome(() => deleteAccountCompletely(f.admin.id, f.ana.email, f.ana.email))).toBe("denied");
    expect(await outcome(() => deleteAccountCompletely(f.siteAdmin.id, f.admin.email, f.admin.email))).toBe("invalid");
    await deleteAccountCompletely(f.siteAdmin.id, f.ana.email, f.ana.email.toUpperCase());
    expect(await db.user.count({ where: { id: f.ana.id } })).toBe(0);
    expect(await db.scoreRecord.count({ where: { studentId: f.ana.id } })).toBe(0);
  });
});

describe("walkthroughs", () => {
  it("show once, to the right people", async () => {
    const [admin, ana, loner] = await Promise.all(["Admin", "Ana", "Loner"].map((n) => createUser(n)));
    const c = await createClass(admin.id, "SAT");
    await db.classMember.create({ data: { classId: c.id, userId: ana.id } });
    expect(await toursToShow(ana.id)).toEqual({ student: true, staff: false });
    expect(await toursToShow(admin.id)).toEqual({ student: false, staff: true });
    expect(await toursToShow(loner.id)).toEqual({ student: false, staff: false });
    await db.user.update({ where: { id: ana.id }, data: { toursSeen: ["student"] } });
    expect((await toursToShow(ana.id)).student).toBe(false);
  });
});

describe("backups and staging", () => {
  it("saves a gzipped dump once a day and drops ones past the retention window", async () => {
    const now = new Date("2026-11-10T03:05:00Z");
    const old = backupKey(new Date(now.getTime() - 30 * 86_400_000));
    await storage.put(old, Buffer.from("old"), "application/gzip");
    expect(await runBackup(now)).toBeNull(); // not enabled
    const r = await runBackup(now, { force: true, dumper: async () => Buffer.from("-- dump") });
    expect(r).toEqual({ key: "backups/2026-11-10.sql.gz", bytes: 7 });
    expect(gunzipSync(await storage.getBuffer(r!.key)).toString()).toBe("-- dump");
    await expect(storage.getBuffer(old)).rejects.toThrow();
  });

  it("refuses to run a staging copy on the production database", () => {
    const prod = "postgresql://u:p@db.example.com:5432/coursebook";
    expect(() => assertNotProductionDatabase({ APP_ENV: "staging", DATABASE_URL: "postgresql://other:pw@db.example.com/coursebook", PRODUCTION_DATABASE_URL: prod })).toThrow(/production database/);
    expect(() => assertNotProductionDatabase({ APP_ENV: "staging", DATABASE_URL: "postgresql://u:p@db.example.com:5432/coursebook_staging", PRODUCTION_DATABASE_URL: prod })).not.toThrow();
    expect(() => assertNotProductionDatabase({ APP_ENV: "production", DATABASE_URL: prod, PRODUCTION_DATABASE_URL: prod })).not.toThrow();
  });
});
