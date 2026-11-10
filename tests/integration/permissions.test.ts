import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError, classAccess } from "@/server/access";
import { assignLessons, assignmentReport, assignQuestions, classProgress, createClass, getClassForTeacher, inviteStudents, removeStudent, skillsReport, updateAssignment, deleteAssignment } from "@/server/classes";
import { addStaff, acceptStaffInvite, cancelStaffInvite, listStaff, removeStaff, resendStaffInvite, staffInviteByToken, updateStaff } from "@/server/staff";
import { createGroup, deleteGroup, listGroups, updateGroup } from "@/server/groups";
import { aiGradesToReview, reviewAiGrade } from "@/server/grade-review";
import { getProgram, transferAdmin, updateProgram } from "@/server/programs";
import { createUser, resetDb } from "../helpers/db";

/**
 * Every permission and scope rule for classes, staff, groups, grading and
 * programs: who can see and who can change what. The fixture is one program
 * with an admin, a teacher, a teacher allowed to manage staff, a Math
 * specialist, a Reading and Writing specialist limited to group B, a viewer,
 * four students in two groups, and a second program's admin.
 */

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email", () => ({
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

const tokenFrom = (text: string) => /staff-invite\/([\w-]+)/.exec(text)?.[1] ?? "";

async function staffAs(classId: string, userId: string, role: "TEACHER" | "SPECIALIST" | "VIEWER", scope: { sections?: string[]; domains?: string[]; groupIds?: string[]; canManageStaff?: boolean } = {}) {
  await db.classStaff.create({ data: { classId, userId, role, sections: scope.sections ?? [], domains: scope.domains ?? [], groupIds: scope.groupIds ?? [], canManageStaff: scope.canManageStaff ?? false } });
}

/** A worksheet owned by `ownerId` with one Math (Algebra) and one R&W (Craft and Structure) question. */
async function taggedWorksheet(ownerId: string) {
  return db.worksheet.create({
    data: {
      ownerId,
      title: "Mixed practice",
      fileKey: `ws-${ownerId}`,
      sizeBytes: BigInt(10),
      status: "READY",
      items: {
        create: [
          { order: 0, label: "1", type: "SHORT_ANSWER", prompt: "Solve 2x = 6.", answer: "3", explanation: "", topic: "Linear", section: "MATH", domain: "algebra", skill: "Linear equations in one variable", tagsConfirmed: true },
          { order: 1, label: "2", type: "SHORT_ANSWER", prompt: "What does 'novel' mean here?", answer: "new", explanation: "", topic: "Words", section: "RW", domain: "craft-structure", skill: "Words in context", tagsConfirmed: true },
        ],
      },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
}

async function fixture() {
  const [admin, teacher, manager, math, rw, viewer, outsider, s1, s2, s3, s4] = await Promise.all(
    ["Admin", "Teacher", "Manager", "Math Spec", "RW Spec", "Viewer", "Other Admin", "Ana", "Ben", "Cal", "Dee"].map((n) => createUser(n)),
  );
  const c = await createClass(admin.id, "SAT Fall");
  const program = await db.program.findFirstOrThrow({ where: { adminId: admin.id } });
  for (const s of [s1, s2, s3, s4]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const groupA = await createGroup(admin.id, c.id, "Group A", [s1.id, s2.id]);
  const groupB = await createGroup(admin.id, c.id, "Group B", [s3.id, s4.id]);
  await staffAs(c.id, teacher.id, "TEACHER");
  await staffAs(c.id, manager.id, "TEACHER", { canManageStaff: true });
  await staffAs(c.id, math.id, "SPECIALIST", { sections: ["MATH"] });
  await staffAs(c.id, rw.id, "SPECIALIST", { sections: ["RW"], groupIds: [groupB.id] });
  await staffAs(c.id, viewer.id, "VIEWER");
  await createClass(outsider.id, "Someone else's class");

  // Work: one Math set, one R&W set, one untagged lesson-free question set.
  const ws = await taggedWorksheet(admin.id);
  const [mathItem, rwItem] = ws.items;
  const [mathA] = await assignQuestions(admin.id, { classIds: [c.id], worksheetId: ws.id, itemIds: [mathItem.id], title: "Algebra set" });
  const [rwA] = await assignQuestions(admin.id, { classIds: [c.id], worksheetId: ws.id, itemIds: [rwItem.id], title: "Words set" });
  const untagged = await db.assignment.create({ data: { classId: c.id, kind: "QUESTIONS", title: "Untagged", worksheetId: ws.id, itemIds: [mathItem.id] } });
  // An AI-graded written answer from every student on each set.
  const answers: Record<string, string> = {};
  for (const s of [s1, s2, s3, s4]) {
    for (const [a, item] of [
      [mathA, mathItem],
      [rwA, rwItem],
    ] as const) {
      const row = await db.assignmentAnswer.create({ data: { assignmentId: a.id, itemId: item.id, userId: s.id, response: "x", correct: false, score: 0.5, verdict: "PARTIAL", feedback: "Close", gradedBy: "CLAUDE" } });
      answers[`${s.name}:${a.title}`] = row.id;
    }
  }
  return { c, program, admin, teacher, manager, math, rw, viewer, outsider, students: { s1, s2, s3, s4 }, groupA, groupB, mathA, rwA, untagged, answers, ws };
}

type F = Awaited<ReturnType<typeof fixture>>;
const actors = ["admin", "teacher", "manager", "math", "rw", "viewer", "outsider"] as const;
type Actor = (typeof actors)[number];
const who = (f: F, a: Actor) => f[a].id;

/** Run `fn` and report "ok", "denied" (403) or "hidden" (not found). */
async function outcome(fn: () => Promise<unknown>): Promise<"ok" | "denied" | "hidden"> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (err instanceof NotFoundError) return "hidden";
    if (err instanceof ClassError && err.status === 403) return "denied";
    throw err;
  }
}

describe("permission matrix: classes and reports", () => {
  it("who can open the class, and which students and assignments each person sees", async () => {
    const f = await fixture();
    const expected: Record<Actor, { open: string; students: number; assignments: string[] } | "hidden"> = {
      admin: { open: "ok", students: 4, assignments: ["Algebra set", "Untagged", "Words set"] },
      teacher: { open: "ok", students: 4, assignments: ["Algebra set", "Untagged", "Words set"] },
      manager: { open: "ok", students: 4, assignments: ["Algebra set", "Untagged", "Words set"] },
      math: { open: "ok", students: 4, assignments: ["Algebra set"] },
      rw: { open: "ok", students: 2, assignments: ["Words set"] },
      viewer: { open: "ok", students: 4, assignments: ["Algebra set", "Untagged", "Words set"] },
      outsider: "hidden",
    };
    for (const a of actors) {
      const want = expected[a];
      if (want === "hidden") {
        expect(await outcome(() => getClassForTeacher(who(f, a), f.c.id)), a).toBe("hidden");
        expect(await outcome(() => classProgress(who(f, a), f.c.id)), a).toBe("hidden");
        continue;
      }
      const view = await getClassForTeacher(who(f, a), f.c.id);
      expect(view.members.length, a).toBe(want.students);
      expect(view.assignments.map((x) => x.title).sort(), a).toEqual(want.assignments);
      const grid = await classProgress(who(f, a), f.c.id);
      expect(grid.students.length, a).toBe(want.students);
      expect(grid.assignments.map((x) => x.title).sort(), a).toEqual(want.assignments);
    }
  });

  it("a Math specialist can't open Reading and Writing work, and an R&W specialist can't open Math", async () => {
    const f = await fixture();
    expect(await outcome(() => assignmentReport(f.math.id, f.mathA.id))).toBe("ok");
    expect(await outcome(() => assignmentReport(f.math.id, f.rwA.id))).toBe("hidden");
    expect(await outcome(() => assignmentReport(f.math.id, f.untagged.id))).toBe("hidden");
    expect(await outcome(() => assignmentReport(f.rw.id, f.mathA.id))).toBe("hidden");
    expect(await outcome(() => assignmentReport(f.outsider.id, f.mathA.id))).toBe("hidden");
    // The group-limited specialist's report only lists their group's students.
    const report = await assignmentReport(f.rw.id, f.rwA.id);
    expect(report.students.map((s) => s.student.name).sort()).toEqual(["Cal", "Dee"]);
    expect(report.questions[0].answers.map((x) => x.studentId).sort()).toEqual([f.students.s3.id, f.students.s4.id].sort());
  });

  it("the skills report only covers the person's subjects and students", async () => {
    const f = await fixture();
    expect((await skillsReport(f.math.id, f.c.id)).map((s) => s.topic)).toEqual(["Linear equations in one variable"]);
    const rw = await skillsReport(f.rw.id, f.c.id);
    expect(rw.map((s) => [s.topic, s.answers])).toEqual([["Words in context", 2]]);
    expect((await skillsReport(f.teacher.id, f.c.id)).length).toBe(2);
  });

  it("viewers can read reports but see no contact details and can't change anything", async () => {
    const f = await fixture();
    const view = await getClassForTeacher(f.viewer.id, f.c.id);
    expect(view.members.every((m) => m.user.email === "")).toBe(true);
    expect(view.invites).toEqual([]);
    expect(await outcome(() => assignLessons(f.viewer.id, f.c.id, { courseId: "x", lessonIds: [] }))).toBe("denied");
    expect(await outcome(() => updateAssignment(f.viewer.id, f.mathA.id, { title: "Hacked" }))).toBe("denied");
    expect(await outcome(() => deleteAssignment(f.viewer.id, f.mathA.id))).toBe("denied");
    expect(await outcome(() => inviteStudents(f.viewer.id, f.c.id, "x@y.org"))).toBe("denied");
    expect(await outcome(() => removeStudent(f.viewer.id, f.c.id, f.students.s1.id))).toBe("denied");
    expect(await outcome(() => reviewAiGrade(f.viewer.id, f.answers["Ana:Algebra set"], { score: 1 }))).toBe("denied");
    expect(await outcome(() => createGroup(f.viewer.id, f.c.id, "Mine"))).toBe("denied");
    expect(await outcome(() => addStaff(f.viewer.id, f.c.id, "new@x.org", { role: "VIEWER" }))).toBe("denied");
  });

  it("only the admin and teachers manage the class and its students; specialists can't", async () => {
    const f = await fixture();
    const expected: Record<Actor, string> = { admin: "ok", teacher: "ok", manager: "ok", math: "denied", rw: "denied", viewer: "denied", outsider: "hidden" };
    for (const a of actors) {
      expect(await outcome(() => inviteStudents(who(f, a), f.c.id, `${a}-invitee@school.org`)), a).toBe(expected[a]);
      expect(await outcome(() => createGroup(who(f, a), f.c.id, `${a}'s group`)), a).toBe(expected[a]);
    }
    expect(await outcome(() => updateGroup(f.math.id, f.c.id, f.groupA.id, { name: "Renamed" }))).toBe("denied");
    expect(await outcome(() => deleteGroup(f.rw.id, f.c.id, f.groupB.id))).toBe("denied");
    expect(await outcome(() => removeStudent(f.math.id, f.c.id, f.students.s1.id))).toBe("denied");
  });

  it("specialists only see their own groups", async () => {
    const f = await fixture();
    expect((await listGroups(f.rw.id, f.c.id)).groups.map((g) => g.name)).toEqual(["Group B"]);
    expect((await listGroups(f.rw.id, f.c.id)).students).toEqual([]);
    expect((await listGroups(f.math.id, f.c.id)).groups.map((g) => g.name)).toEqual(["Group A", "Group B"]);
  });
});

describe("permission matrix: assigning work", () => {
  it("specialists can only assign work in their subjects", async () => {
    const f = await fixture();
    const book = await db.book.create({ data: { userId: f.math.id, originalFilename: "m.pdf", storageKey: "k", sizeBytes: BigInt(1), status: "READY", pageCount: 1 } });
    const course = await db.course.create({ data: { userId: f.math.id, bookId: book.id, title: "Math notes", status: "ACTIVE", settings: {} } });
    expect(await outcome(() => assignLessons(f.math.id, f.c.id, { courseId: course.id, lessonIds: [], section: "MATH" }))).toBe("ok");
    expect(await outcome(() => assignLessons(f.math.id, f.c.id, { courseId: course.id, lessonIds: [], domains: ["advanced-math"] }))).toBe("ok");
    expect(await outcome(() => assignLessons(f.math.id, f.c.id, { courseId: course.id, lessonIds: [], section: "RW" }))).toBe("denied");
    expect(await outcome(() => assignLessons(f.math.id, f.c.id, { courseId: course.id, lessonIds: [] }))).toBe("denied"); // untagged
    // Question sets take their subject from the questions' tags.
    const ws = await taggedWorksheet(f.math.id);
    expect(await outcome(() => assignQuestions(f.math.id, { classIds: [f.c.id], worksheetId: ws.id, itemIds: [ws.items[0].id], title: "Mine" }))).toBe("ok");
    expect(await outcome(() => assignQuestions(f.math.id, { classIds: [f.c.id], worksheetId: ws.id, itemIds: [ws.items[1].id], title: "Not mine" }))).toBe("denied");
    expect(await outcome(() => assignQuestions(f.math.id, { classIds: [f.c.id], worksheetId: ws.id, itemIds: [], title: "Mixed" }))).toBe("denied");
  });

  it("specialists can only change or delete assignments in their subjects", async () => {
    const f = await fixture();
    expect(await outcome(() => updateAssignment(f.math.id, f.mathA.id, { title: "Algebra set 1" }))).toBe("ok");
    expect(await outcome(() => updateAssignment(f.math.id, f.rwA.id, { title: "Mine now" }))).toBe("hidden");
    expect(await outcome(() => deleteAssignment(f.rw.id, f.mathA.id))).toBe("hidden");
    expect(await outcome(() => deleteAssignment(f.outsider.id, f.rwA.id))).toBe("hidden");
    expect(await db.assignment.count({ where: { id: { in: [f.mathA.id, f.rwA.id] } } })).toBe(2);
  });
});

describe("permission matrix: AI grade review", () => {
  it("each person reviews only AI grades for their subjects and students", async () => {
    const f = await fixture();
    const seen = async (a: Actor) => (await aiGradesToReview(who(f, a), f.c.id)).answers.map((x) => `${x.user.name}:${x.assignment.title}`).sort();
    expect((await seen("teacher")).length).toBe(8);
    expect(await seen("math")).toEqual(["Ana:Algebra set", "Ben:Algebra set", "Cal:Algebra set", "Dee:Algebra set"]);
    expect(await seen("rw")).toEqual(["Cal:Words set", "Dee:Words set"]);
    expect(await outcome(() => aiGradesToReview(f.outsider.id, f.c.id))).toBe("hidden");
  });

  it("grading outside one's scope is refused; overrides are logged and confirmations aren't", async () => {
    const f = await fixture();
    expect(await outcome(() => reviewAiGrade(f.math.id, f.answers["Ana:Words set"], { score: 1 }))).toBe("hidden");
    expect(await outcome(() => reviewAiGrade(f.rw.id, f.answers["Ana:Words set"], { score: 1 }))).toBe("hidden"); // group A
    expect(await outcome(() => reviewAiGrade(f.rw.id, f.answers["Cal:Algebra set"], { score: 1 }))).toBe("hidden");
    expect(await outcome(() => reviewAiGrade(f.outsider.id, f.answers["Cal:Algebra set"], { score: 1 }))).toBe("hidden");
    await reviewAiGrade(f.rw.id, f.answers["Cal:Words set"], { score: 1, feedback: "Good enough" });
    await reviewAiGrade(f.math.id, f.answers["Ana:Algebra set"], {});
    const cal = await db.assignmentAnswer.findUniqueOrThrow({ where: { id: f.answers["Cal:Words set"] } });
    expect(cal).toMatchObject({ score: 1, aiScore: 0.5, correct: true, gradedBy: "TEACHER", feedback: "Good enough", reviewedById: f.rw.id });
    const ana = await db.assignmentAnswer.findUniqueOrThrow({ where: { id: f.answers["Ana:Algebra set"] } });
    expect(ana).toMatchObject({ score: 0.5, gradedBy: "CLAUDE", reviewedById: f.math.id });
    const log = await db.auditLog.findMany({ where: { action: "grade.override" } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: f.rw.id, targetId: cal.id });
    expect((await aiGradesToReview(f.rw.id, f.c.id)).answers.map((x) => x.user.name)).toEqual(["Dee"]);
  });
});

describe("permission matrix: staff", () => {
  it("only the admin, or a teacher they allow, adds, changes or removes staff", async () => {
    const f = await fixture();
    const expected: Record<Actor, string> = { admin: "ok", manager: "ok", teacher: "denied", math: "denied", rw: "denied", viewer: "denied", outsider: "hidden" };
    for (const a of actors) {
      expect(await outcome(() => addStaff(who(f, a), f.c.id, `${a}-hire@school.org`, { role: "VIEWER" })), a).toBe(expected[a]);
      expect(await outcome(() => updateStaff(who(f, a), f.c.id, f.viewer.id, { role: "VIEWER" })), a).toBe(expected[a]);
    }
    expect(await outcome(() => removeStaff(f.teacher.id, f.c.id, f.math.id))).toBe("denied");
    expect(await outcome(() => removeStaff(f.math.id, f.c.id, f.rw.id))).toBe("denied");
    // A teacher who manages staff can't hand that power on, or change another manager.
    expect(await outcome(() => addStaff(f.manager.id, f.c.id, "boss@school.org", { role: "TEACHER", canManageStaff: true }))).toBe("denied");
    const other = await createUser("Other manager");
    await staffAs(f.c.id, other.id, "TEACHER", { canManageStaff: true });
    expect(await outcome(() => removeStaff(f.manager.id, f.c.id, other.id))).toBe("denied");
    expect(await outcome(() => updateStaff(f.manager.id, f.c.id, other.id, { role: "VIEWER" }))).toBe("denied");
    expect(await outcome(() => updateStaff(f.admin.id, f.c.id, other.id, { role: "VIEWER" }))).toBe("ok");
  });

  it("removal and role changes take effect on the very next request", async () => {
    const f = await fixture();
    await getClassForTeacher(f.math.id, f.c.id);
    await removeStaff(f.admin.id, f.c.id, f.math.id);
    expect(await outcome(() => getClassForTeacher(f.math.id, f.c.id))).toBe("hidden");
    expect(await outcome(() => reviewAiGrade(f.math.id, f.answers["Ana:Algebra set"], { score: 1 }))).toBe("hidden");
    // A teacher made a viewer can no longer assign.
    await updateStaff(f.admin.id, f.c.id, f.teacher.id, { role: "VIEWER" });
    expect((await classAccess(f.teacher.id, f.c.id)).role).toBe("VIEWER");
    expect(await outcome(() => updateAssignment(f.teacher.id, f.mathA.id, { title: "x" }))).toBe("denied");
    // A specialist moved from Math to R&W loses Math at once.
    await updateStaff(f.admin.id, f.c.id, f.rw.id, { role: "SPECIALIST", sections: ["MATH"], groupIds: [f.groupB.id] });
    expect(await outcome(() => assignmentReport(f.rw.id, f.rwA.id))).toBe("hidden");
    expect(await outcome(() => assignmentReport(f.rw.id, f.mathA.id))).toBe("ok");
  });

  it("checks scopes: specialists need subjects or groups, and groups must be in the class", async () => {
    const f = await fixture();
    await expect(addStaff(f.admin.id, f.c.id, "x@school.org", { role: "SPECIALIST" })).rejects.toThrow("Choose the subjects or groups");
    const elsewhere = await db.classGroup.create({ data: { classId: (await db.class.findFirstOrThrow({ where: { teacherId: f.outsider.id } })).id, name: "Theirs" } });
    await expect(addStaff(f.admin.id, f.c.id, "x@school.org", { role: "SPECIALIST", groupIds: [elsewhere.id] })).rejects.toThrow("aren't in this class");
    await expect(addStaff(f.admin.id, f.c.id, f.students.s1.email, { role: "TEACHER" })).rejects.toThrow("student in this class");
    await expect(addStaff(f.admin.id, f.c.id, f.math.email, { role: "TEACHER" })).rejects.toThrow("already on this class's staff");
    // Unknown subjects are dropped, not stored.
    await addStaff(f.admin.id, f.c.id, f.outsider.email, { role: "SPECIALIST", sections: ["MATH", "HISTORY"], domains: ["nope"] });
    expect(await db.classStaff.findFirstOrThrow({ where: { userId: f.outsider.id, classId: f.c.id } })).toMatchObject({ sections: ["MATH"], domains: [] });
  });

  it("existing accounts get access right away and an email; others get an invite link", async () => {
    const f = await fixture();
    const existing = await createUser("Existing tutor");
    expect(await addStaff(f.admin.id, f.c.id, existing.email.toUpperCase(), { role: "SPECIALIST", sections: ["RW"] })).toEqual({ added: true });
    expect((await classAccess(existing.id, f.c.id)).role).toBe("SPECIALIST");
    expect(sent.at(-1)).toMatchObject({ to: existing.email, subject: "You've been added to SAT Fall (Admin's tutoring program)" });
    expect(await addStaff(f.admin.id, f.c.id, "New.Person@School.org", { role: "VIEWER" })).toEqual({ invited: true });
    expect(sent.at(-1)!.to).toBe("new.person@school.org");
    expect(tokenFrom(sent.at(-1)!.text)).toHaveLength(43);
    const staff = await listStaff(f.admin.id, f.c.id);
    expect(staff.invites.map((i) => i.email)).toEqual(["new.person@school.org"]);
    // Staff without management rights don't see invites or emails.
    const asMath = await listStaff(f.math.id, f.c.id);
    expect(asMath.invites).toEqual([]);
    expect(asMath.staff.every((s) => s.email === null && s.lastLoginAt === null)).toBe(true);
  });

  it("invite links: only the invited address, once, before they expire; resend replaces the link; cancel stops it", async () => {
    const f = await fixture();
    const now = new Date();
    await addStaff(f.admin.id, f.c.id, "tutor@school.org", { role: "SPECIALIST", groupIds: [f.groupA.id] }, now);
    const token = tokenFrom(sent.at(-1)!.text);
    expect(await staffInviteByToken(token)).toMatchObject({ state: "pending", email: "tutor@school.org", className: "SAT Fall" });
    const wrong = await createUser("Wrong person");
    await expect(acceptStaffInvite(wrong.id, token)).rejects.toThrow("This invite is for tutor@school.org");
    const tutor = await createUser("Tutor");
    await db.user.update({ where: { id: tutor.id }, data: { email: "tutor@school.org" } });
    // Expired.
    await expect(acceptStaffInvite(tutor.id, token, new Date(now.getTime() + 8 * 86_400_000))).rejects.toThrow("expired");
    // Resend: the old link stops working, the new one works.
    await resendStaffInvite(f.admin.id, f.c.id, (await db.staffInvite.findFirstOrThrow()).id, now);
    const fresh = tokenFrom(sent.at(-1)!.text);
    expect(fresh).not.toBe(token);
    await expect(acceptStaffInvite(tutor.id, token)).rejects.toThrow("isn't valid");
    expect(await acceptStaffInvite(tutor.id, fresh)).toBe(f.c.id);
    const access = await classAccess(tutor.id, f.c.id);
    expect(access).toMatchObject({ role: "SPECIALIST", groupIds: [f.groupA.id] });
    expect((await getClassForTeacher(tutor.id, f.c.id)).members.map((m) => m.user.name).sort()).toEqual(["Ana", "Ben"]);
    // Used.
    await expect(acceptStaffInvite(tutor.id, fresh)).rejects.toThrow("already been used");
    // Cancelled.
    await addStaff(f.admin.id, f.c.id, "other@school.org", { role: "VIEWER" });
    const t2 = tokenFrom(sent.at(-1)!.text);
    await cancelStaffInvite(f.admin.id, f.c.id, (await db.staffInvite.findFirstOrThrow({ where: { email: "other@school.org" } })).id);
    expect((await staffInviteByToken(t2))!.state).toBe("cancelled");
    // Only managers can resend or cancel.
    await addStaff(f.admin.id, f.c.id, "third@school.org", { role: "VIEWER" });
    const inv = await db.staffInvite.findFirstOrThrow({ where: { email: "third@school.org" } });
    expect(await outcome(() => cancelStaffInvite(f.teacher.id, f.c.id, inv.id))).toBe("denied");
    expect(await outcome(() => resendStaffInvite(f.math.id, f.c.id, inv.id))).toBe("denied");
  });

  it("writes exactly one audit row per change", async () => {
    const f = await fixture();
    const count = () => db.auditLog.count({ where: { programId: f.program.id } });
    const steps: [string, () => Promise<unknown>][] = [
      ["staff.add", () => addStaff(f.admin.id, f.c.id, f.outsider.email, { role: "VIEWER" })],
      ["staff.invite", () => addStaff(f.admin.id, f.c.id, "new@school.org", { role: "TEACHER" })],
      ["staff.update", () => updateStaff(f.admin.id, f.c.id, f.math.id, { role: "SPECIALIST", domains: ["algebra"] })],
      ["staff.remove", () => removeStaff(f.manager.id, f.c.id, f.viewer.id)],
      ["group.create", () => createGroup(f.teacher.id, f.c.id, "Tuesday")],
      ["grade.override", () => reviewAiGrade(f.teacher.id, f.answers["Ben:Algebra set"], { score: 0 })],
    ];
    for (const [action, step] of steps) {
      const before = await count();
      await step();
      expect(await count(), action).toBe(before + 1);
      const last = await db.auditLog.findFirstOrThrow({ where: { programId: f.program.id }, orderBy: { createdAt: "desc" } });
      expect(last.action).toBe(action);
    }
    const update = await db.auditLog.findFirstOrThrow({ where: { action: "staff.update" } });
    expect(update.summary).toBe("Math Spec in SAT Fall: Specialist (Math) → Specialist (Algebra)");
    expect(update.before).toMatchObject({ sections: ["MATH"] });
    // Failed attempts write nothing.
    const before = await count();
    await outcome(() => addStaff(f.teacher.id, f.c.id, "x@school.org", { role: "VIEWER" }));
    expect(await count()).toBe(before);
  });
});

describe("permission matrix: programs", () => {
  it("only the admin sees and changes program settings and the audit log", async () => {
    const f = await fixture();
    expect(await outcome(() => getProgram(f.admin.id, f.program.id))).toBe("ok");
    for (const a of ["teacher", "manager", "math", "viewer"] as const) {
      expect(await outcome(() => getProgram(who(f, a), f.program.id)), a).toBe("denied");
      expect(await outcome(() => updateProgram(who(f, a), f.program.id, { name: "Mine" })), a).toBe("denied");
    }
    expect(await outcome(() => getProgram(f.outsider.id, f.program.id))).toBe("hidden");
    await updateProgram(f.admin.id, f.program.id, { targets: [1305, 1200, 2000], aiDailyCapCents: 500 });
    expect(await db.program.findUniqueOrThrow({ where: { id: f.program.id } })).toMatchObject({ targets: [1200, 1310], aiDailyCapCents: 500 });
  });

  it("the admin role can be handed to a staff member, who gets full control at once", async () => {
    const f = await fixture();
    for (const a of ["teacher", "manager", "math"] as const) {
      expect(await outcome(() => transferAdmin(who(f, a), f.program.id, { toUserId: f.teacher.id, confirmName: f.program.name })), a).toBe("denied");
    }
    await expect(transferAdmin(f.admin.id, f.program.id, { toUserId: f.teacher.id, confirmName: "wrong" })).rejects.toThrow("Type the program's name");
    await expect(transferAdmin(f.admin.id, f.program.id, { toUserId: f.outsider.id, confirmName: f.program.name })).rejects.toThrow("on the program's staff");
    await transferAdmin(f.admin.id, f.program.id, { toUserId: f.teacher.id, confirmName: f.program.name });
    expect((await classAccess(f.teacher.id, f.c.id)).role).toBe("ADMIN");
    // The old admin stays as a teacher, without staff management or program settings.
    expect((await classAccess(f.admin.id, f.c.id)).role).toBe("TEACHER");
    expect(await outcome(() => addStaff(f.admin.id, f.c.id, "x@school.org", { role: "VIEWER" }))).toBe("denied");
    expect(await outcome(() => getProgram(f.admin.id, f.program.id))).toBe("denied");
    expect(await outcome(() => addStaff(f.teacher.id, f.c.id, "y@school.org", { role: "VIEWER" }))).toBe("ok");
    expect(sent.some((m) => m.to === f.teacher.email && m.subject.includes("now the admin"))).toBe(true);
    expect(await db.auditLog.count({ where: { action: "program.transfer" } })).toBe(1);
    // The site admin can recover a program whose admin left.
    await transferAdmin(f.outsider.id, f.program.id, { toUserId: f.admin.id, confirmName: f.program.name }, { asSiteAdmin: true });
    expect((await classAccess(f.admin.id, f.c.id)).role).toBe("ADMIN");
  });

  it("new classes go in the admin's program; staff can't add classes to it", async () => {
    const f = await fixture();
    const second = await createClass(f.admin.id, "SAT Spring", f.program.id);
    expect(second.programId).toBe(f.program.id);
    await expect(createClass(f.teacher.id, "Sneaky", f.program.id)).rejects.toThrow("Only the program admin");
    // A teacher's own class starts their own, separate program.
    const own = await createClass(f.teacher.id, "Private tutoring");
    expect(own.programId).not.toBe(f.program.id);
    expect(await outcome(() => getClassForTeacher(f.admin.id, own.id))).toBe("hidden");
  });
});
