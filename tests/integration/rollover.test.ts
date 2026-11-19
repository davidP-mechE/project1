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

  it("copies courses and question sets for the classes ticked, undated; leaves per-student work behind", async () => {
    const [admin, ana] = await Promise.all(["Admin", "Ana"].map((n) => createUser(n)));
    const c = await createClass(admin.id, "SAT Math (Fall 2026)");
    const plain = await createClass(admin.id, "Reading club");
    await db.classMember.create({ data: { classId: c.id, userId: ana.id } });
    const g = await createGroup(admin.id, c.id, "Group B", [ana.id]);
    const program = await db.program.findFirstOrThrow({ where: { adminId: admin.id } });
    const book = await db.book.create({ data: { userId: admin.id, originalFilename: "b.pdf", storageKey: "k", sizeBytes: BigInt(1), status: "READY", pageCount: 1 } });
    const course = await db.course.create({ data: { userId: admin.id, bookId: book.id, title: "Algebra notes", status: "ACTIVE", settings: {} } });
    const book2 = await db.book.create({ data: { userId: admin.id, originalFilename: "c.pdf", storageKey: "k2", sizeBytes: BigInt(1), status: "READY", pageCount: 1 } });
    const gone = await db.course.create({ data: { userId: admin.id, bookId: book2.id, title: "Deleted later", status: "ACTIVE", settings: {} } });
    const cc = await db.classCourse.create({ data: { classId: c.id, sourceCourseId: course.id, title: "Algebra notes", fileKey: "snap", snapshotOf: "x" } });
    await db.classCourse.create({ data: { classId: c.id, sourceCourseId: gone.id, title: "Deleted later" } });
    await db.course.delete({ where: { id: gone.id } });
    await db.classCourse.create({ data: { classId: plain.id, sourceCourseId: course.id, title: "Algebra notes" } });
    const set = await db.questionSet.create({ data: { title: "Linear drill", questionIds: [], status: "published", visibility: "class", authorId: admin.id } });
    const privateSet = await db.questionSet.create({ data: { title: "Mine", questionIds: [], status: "published", visibility: "private", authorId: admin.id } });
    const autoSet = await db.questionSet.create({ data: { title: "Weekly: Ana", questionIds: [], status: "published", visibility: "class", autoForStudentId: ana.id } });
    const due = new Date("2026-10-01T00:00:00Z");
    await db.assignment.createMany({
      data: [
        { classId: c.id, kind: "LESSONS", classCourseId: cc.id, title: "Chapter 1", lessonIds: ["l1"], dueAt: due },
        { classId: c.id, kind: "QUESTION_SET", questionSetId: set.id, title: "Linear drill", dueAt: due, timeLimitMin: 20, calculator: "BY_HAND", groupIds: [g.id] },
        { classId: c.id, kind: "QUESTION_SET", questionSetId: set.id, title: "Just Ana", studentIds: [ana.id] },
        { classId: c.id, kind: "QUESTION_SET", questionSetId: privateSet.id, title: "Private" },
        { classId: c.id, kind: "QUESTION_SET", questionSetId: autoSet.id, title: "Weekly", studentIds: [ana.id] },
        { classId: c.id, kind: "EXTERNAL", title: "CB link" },
      ],
    });

    // Copying is only for classes being carried forward.
    await expect(startSemester(admin.id, program.id, { semester: "Spring 2027", classIds: [c.id], reinvite: false, copyWork: [plain.id] })).rejects.toBeInstanceOf(ClassError);
    const r = await startSemester(admin.id, program.id, { semester: "Spring 2027", classIds: [c.id, plain.id], reinvite: false, copyWork: [c.id] });
    const [a, b] = r.created;
    expect([a.courses, a.assignments, b.courses, b.assignments]).toEqual([1, 2, 0, 0]);
    const fresh = await db.class.findUniqueOrThrow({ where: { id: a.id }, include: { courses: true, groups: true, assignments: { orderBy: { title: "asc" } } } });
    expect(fresh.courses).toMatchObject([{ sourceCourseId: course.id, title: "Algebra notes", fileKey: null, snapshotOf: null }]);
    expect(fresh.assignments.map((x) => ({ title: x.title, kind: x.kind, dueAt: x.dueAt, classCourseId: x.classCourseId, groupIds: x.groupIds, studentIds: x.studentIds, timeLimitMin: x.timeLimitMin, calculator: x.calculator }))).toEqual([
      { title: "Chapter 1", kind: "LESSONS", dueAt: null, classCourseId: fresh.courses[0].id, groupIds: [], studentIds: [], timeLimitMin: null, calculator: "ALLOWED" },
      { title: "Linear drill", kind: "QUESTION_SET", dueAt: null, classCourseId: null, groupIds: [fresh.groups[0].id], studentIds: [], timeLimitMin: 20, calculator: "BY_HAND" },
    ]);
    // The unticked class gets nothing; the old class keeps its work.
    expect(await db.classCourse.count({ where: { classId: b.id } })).toBe(0);
    expect(await db.assignment.count({ where: { classId: c.id } })).toBe(6);
  });
});
