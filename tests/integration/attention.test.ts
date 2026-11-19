import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { assignQuestions, assignQuestionSet } from "@/server/classes";
import { attentionCount, attentionList, forgetAttentionCounts, markAttention, reopenAttention, setsForSkill } from "@/server/attention";
import { assignTutor, assignTutorToClass, caseloadView, importCaseloadCsv, primaryTutorsOf } from "@/server/caseloads";
import { updateProgram } from "@/server/programs";
import { ensureReferenceData } from "@/server/seed/reference";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T15:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

beforeEach(async () => {
  await resetDb();
  await ensureReferenceData({ onlyIfEmpty: false });
  forgetAttentionCounts();
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

const MATH_SKILL = "math.algebra.linear-equations-in-one-variable";
const RW_SKILL = "rw.conventions.boundaries";

/** One program: an admin, a group-B specialist, a Reading-and-Writing-only specialist, a viewer; Ana in group A, Ben and Cal in group B. */
async function fixture() {
  const [admin, groupTutor, rwTutor, viewer, outsider, ana, ben, cal] = await Promise.all(["Admin", "Group tutor", "RW tutor", "Viewer", "Outsider", "Ana", "Ben", "Cal"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gA = await createGroup(admin.id, c.id, "A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "B", [ben.id, cal.id]);
  await db.classStaff.createMany({
    data: [
      { classId: c.id, userId: groupTutor.id, role: "SPECIALIST", groupIds: [gB.id] },
      { classId: c.id, userId: rwTutor.id, role: "SPECIALIST", sections: ["RW"] },
      { classId: c.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  // Everyone was active recently, so only what each test sets up shows.
  await db.user.updateMany({ data: { lastLoginAt: ago(1), createdAt: ago(90) } });
  // An outsider's own program with a student, to prove it never leaks.
  const other = await createClass(outsider.id, "Other program");
  const zed = await createUser("Zed");
  await db.classMember.create({ data: { classId: other.id, userId: zed.id } });
  await db.user.update({ where: { id: zed.id }, data: { lastLoginAt: ago(40), createdAt: ago(90) } });
  return { c, other, admin, groupTutor, rwTutor, viewer, outsider, ana, ben, cal, zed, gA, gB, programId: c.programId! };
}

async function bankQuestion(skillId: string, author: string) {
  return db.bankQuestion.create({ data: { section: skillId.startsWith("math") ? "math" : "rw", skillId, type: "mcq", stem: "Q?", choices: ["a", "b", "c", "d"], answer: "A", status: "published", authorId: author } });
}

async function answers(userId: string, questionId: string, list: { daysAgo: number; correct: boolean }[]) {
  await db.bankAttempt.createMany({ data: list.map((x) => ({ userId, questionId, questionVersion: 1, answerGiven: x.correct ? "A" : "B", correct: x.correct, createdAt: ago(x.daysAgo) })) });
}

const reasonsFor = async (viewer: string, student: string, opts = {}) => (await attentionList(viewer, opts, NOW)).items.filter((i) => i.studentId === student).map((i) => i.reason).sort();

describe("needs attention: the reasons", () => {
  it("missed work: overdue and not done, only for students it was assigned to", async () => {
    const f = await fixture();
    const ws = await db.worksheet.create({ data: { ownerId: f.admin.id, title: "WS", fileKey: "k", sizeBytes: BigInt(1), status: "READY", items: { create: [{ order: 0, label: "1", type: "MULTIPLE_CHOICE", prompt: "Q", choices: ["a", "b"], correctChoice: 0, answer: "a", explanation: "", topic: "t" }] } } });
    const [a] = await assignQuestions(f.admin.id, { classIds: [f.c.id], worksheetId: ws.id, itemIds: [], title: "Week 1 drill", targets: { groupIds: [f.gB.id] } });
    await db.assignment.update({ where: { id: a.id }, data: { dueAt: ago(2) } });
    const list = await attentionList(f.admin.id, {}, NOW);
    const work = list.items.filter((i) => i.reason === "WORK");
    expect(work.map((i) => i.name).sort()).toEqual(["Ben", "Cal"]);
    expect(work[0].detail).toMatch(/1 overdue: Week 1 drill/);
    expect(work[0].numbers).toEqual(expect.arrayContaining([{ label: "Overdue", value: "1" }]));
  });

  it("inactive after the program's number of days (no login and no practice)", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.ana.id }, data: { lastLoginAt: ago(5) } });
    expect(await reasonsFor(f.admin.id, f.ana.id)).toEqual([]); // default: 7 days
    await updateProgram(f.admin.id, f.programId, { inactiveDays: 3 });
    expect(await reasonsFor(f.admin.id, f.ana.id)).toEqual(["INACTIVE"]);
    // Practising counts as activity even without a login.
    const q = await bankQuestion(MATH_SKILL, f.admin.id);
    await answers(f.ana.id, q.id, [{ daysAgo: 1, correct: true }]);
    expect(await reasonsFor(f.admin.id, f.ana.id)).toEqual([]);
    await expect(updateProgram(f.admin.id, f.programId, { inactiveDays: 1 })).rejects.toThrow(/2 to 60/);
  });

  it("accuracy dropping: the last 2 weeks against the 4 before, in the viewer's subjects only", async () => {
    const f = await fixture();
    const q = await bankQuestion(MATH_SKILL, f.admin.id);
    await answers(f.ben.id, q.id, [...Array.from({ length: 10 }, () => ({ daysAgo: 25, correct: true })), ...Array.from({ length: 10 }, (_, i) => ({ daysAgo: 3, correct: i < 4 }))]);
    const item = (await attentionList(f.admin.id, { reason: "ACCURACY" }, NOW)).items[0];
    expect(item).toMatchObject({ name: "Ben", reason: "ACCURACY", detail: "40% in the last 2 weeks, down from 100%" });
    // Math accuracy is outside a Reading and Writing specialist's scope.
    expect(await reasonsFor(f.rwTutor.id, f.ben.id)).not.toContain("ACCURACY");
    // Too few answers: nothing.
    await db.bankAttempt.deleteMany({ where: { userId: f.ben.id, createdAt: { gte: ago(5) } } });
    await answers(f.ben.id, q.id, [{ daysAgo: 2, correct: false }]);
    expect(await reasonsFor(f.admin.id, f.ben.id)).not.toContain("ACCURACY");
  });

  it("the same skill missed again and again (bank practice, the error log and the mistake log)", async () => {
    const f = await fixture();
    const q = await bankQuestion(RW_SKILL, f.admin.id);
    await answers(f.cal.id, q.id, [{ daysAgo: 2, correct: false }, { daysAgo: 4, correct: false }]);
    expect(await reasonsFor(f.admin.id, f.cal.id)).not.toContain("SKILL");
    await db.mistakeItem.create({ data: { studentId: f.cal.id, sourceType: "SCORE", sourceId: "s1", section: "RW", domain: "conventions", skill: "Boundaries", label: "Q5", due: NOW, createdAt: ago(1) } });
    const item = (await attentionList(f.admin.id, { reason: "SKILL" }, NOW)).items[0];
    expect(item).toMatchObject({ name: "Cal", skill: { id: RW_SKILL, name: "Boundaries" }, detail: "Missed Boundaries 3 times in 30 days" });
    // The RW specialist sees it; a Math-only view wouldn't.
    expect(await reasonsFor(f.rwTutor.id, f.cal.id)).toContain("SKILL");
    expect((await setsForSkill(RW_SKILL)).length).toBe(0); // no published set yet
  });

  it("below target pace: the score estimate under the line from baseline to target by the test date", async () => {
    const f = await fixture();
    await db.scoreRecord.create({ data: { studentId: f.ana.id, source: "PSAT", takenOn: ago(60), total: 1000, isBaseline: true, enteredById: f.admin.id } });
    await db.scoreRecord.create({ data: { studentId: f.ana.id, source: "PRACTICE_BLUEBOOK", takenOn: ago(10), total: 1010, enteredById: f.ana.id } });
    await db.studentProfile.create({ data: { userId: f.ana.id, targetScore: 1400, testDate: new Date(NOW.getTime() + 30 * DAY) } });
    const item = (await attentionList(f.admin.id, { reason: "PACE" }, NOW)).items[0];
    expect(item.name).toBe("Ana");
    expect(item.numbers.find((n) => n.label === "Target")?.value).toBe("1400");
    // On pace: no item.
    await db.scoreRecord.create({ data: { studentId: f.ana.id, source: "SAT", takenOn: ago(1), total: 1300, enteredById: f.admin.id } });
    expect(await reasonsFor(f.admin.id, f.ana.id)).not.toContain("PACE");
  });

  it("ranks by priority across reasons", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.cal.id }, data: { lastLoginAt: ago(10) } });
    await db.scoreRecord.create({ data: { studentId: f.ana.id, source: "PSAT", takenOn: ago(60), total: 900, isBaseline: true, enteredById: f.admin.id } });
    await db.studentProfile.create({ data: { userId: f.ana.id, targetScore: 1400, testDate: new Date(NOW.getTime() + 20 * DAY) } });
    const items = (await attentionList(f.admin.id, {}, NOW)).items;
    expect(items.map((i) => i.reason)).toEqual(["PACE", "INACTIVE"]);
    expect(items[0].priority).toBeGreaterThan(items[1].priority);
  });
});

describe("needs attention: scope", () => {
  it("staff see only students in their scope; outsiders see nothing; the admin sees the program", async () => {
    const f = await fixture();
    await db.user.updateMany({ where: { id: { in: [f.ana.id, f.ben.id] } }, data: { lastLoginAt: ago(20) } });
    expect((await attentionList(f.admin.id, {}, NOW)).items.map((i) => i.name).sort()).toEqual(["Ana", "Ben"]);
    expect((await attentionList(f.groupTutor.id, {}, NOW)).items.map((i) => i.name)).toEqual(["Ben"]); // group B only
    expect((await attentionList(f.viewer.id, {}, NOW)).items.every((i) => !i.canAct)).toBe(true);
    // The outsider sees their own student, never this program's.
    expect((await attentionList(f.outsider.id, {}, NOW)).items.map((i) => i.name)).toEqual(["Zed"]);
    // A student sees nothing (they have no classes to teach).
    expect((await attentionList(f.ana.id, {}, NOW)).items).toEqual([]);
    // A class filter outside your classes is "not found".
    expect(await outcome(() => attentionList(f.outsider.id, { classId: f.c.id }, NOW))).toBe("hidden");
  });

  it("handled hides an item until something new happens; snoozed until the days pass; viewers and outsiders can't", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.ben.id }, data: { lastLoginAt: ago(10) } });
    const mark = (who: string, action: "HANDLED" | "SNOOZED", days?: number) => markAttention(who, { classId: f.c.id, studentId: f.ben.id, reason: "INACTIVE", action, days }, NOW);
    expect(await outcome(() => mark(f.viewer.id, "HANDLED"))).toBe("denied");
    expect(await outcome(() => mark(f.outsider.id, "HANDLED"))).toBe("hidden");
    expect(await outcome(() => markAttention(f.groupTutor.id, { classId: f.c.id, studentId: f.ana.id, reason: "INACTIVE", action: "HANDLED" }, NOW))).toBe("hidden");

    await mark(f.groupTutor.id, "HANDLED");
    // Shared by the program's staff: hidden for the admin too.
    const list = await attentionList(f.admin.id, {}, NOW);
    expect(list.items).toEqual([]);
    expect(list.hiddenCount).toBe(1);
    // Something new (Ben logs in, then goes quiet again): it comes back.
    await db.user.update({ where: { id: f.ben.id }, data: { lastLoginAt: ago(9) } });
    expect(await reasonsFor(f.admin.id, f.ben.id)).toEqual(["INACTIVE"]);

    // Snooze for 3 days: hidden now, back after.
    await mark(f.admin.id, "SNOOZED", 3);
    expect(await reasonsFor(f.admin.id, f.ben.id)).toEqual([]);
    expect((await attentionList(f.admin.id, {}, new Date(NOW.getTime() + 4 * DAY))).items.map((i) => i.name)).toContain("Ben");
    await reopenAttention(f.admin.id, { classId: f.c.id, studentId: f.ben.id, reason: "INACTIVE" });
    expect(await reasonsFor(f.admin.id, f.ben.id)).toEqual(["INACTIVE"]);
    // An item that isn't there can't be marked.
    expect(await outcome(() => markAttention(f.admin.id, { classId: f.c.id, studentId: f.ana.id, reason: "PACE", action: "HANDLED" }, NOW))).toBe("invalid");
  });

  it("the sidebar count matches the list", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.cal.id }, data: { lastLoginAt: ago(30) } });
    expect(await attentionCount(f.groupTutor.id, NOW)).toBe(1);
    expect(await attentionCount(f.rwTutor.id, NOW)).toBe(1);
    expect(await attentionCount(f.ana.id, NOW)).toBe(0);
  });

  it("assign practice: only to a student in scope, from a published set", async () => {
    const f = await fixture();
    const q = await bankQuestion(RW_SKILL, f.admin.id);
    const set = await db.questionSet.create({ data: { title: "Boundaries drill", questionIds: [q.id], skillIds: [RW_SKILL], status: "published", visibility: "class", authorId: f.admin.id } });
    expect((await setsForSkill(RW_SKILL)).map((s) => s.title)).toEqual(["Boundaries drill"]);
    const a = await assignQuestionSet(f.groupTutor.id, f.c.id, { setId: set.id, targets: { studentIds: [f.ben.id], groupIds: [] } });
    expect(a.studentIds).toEqual([f.ben.id]);
    expect(await outcome(() => assignQuestionSet(f.groupTutor.id, f.c.id, { setId: set.id, targets: { studentIds: [f.ana.id], groupIds: [] } }))).toBe("denied");
  });
});

describe("caseloads", () => {
  it("only the program admin assigns, and only to staff who teach the student", async () => {
    const f = await fixture();
    expect(await outcome(() => assignTutor(f.groupTutor.id, f.programId, [f.ben.id], f.groupTutor.id))).toBe("hidden");
    expect(await outcome(() => assignTutor(f.outsider.id, f.programId, [f.ben.id], f.outsider.id))).toBe("hidden");
    // The group tutor teaches Ben and Cal, not Ana; viewers and outsiders can't hold a caseload.
    expect(await assignTutor(f.admin.id, f.programId, [f.ana.id, f.ben.id, f.cal.id], f.groupTutor.id)).toEqual({ assigned: 2, skipped: 1 });
    expect(await assignTutor(f.admin.id, f.programId, [f.ana.id], f.viewer.id)).toEqual({ assigned: 0, skipped: 1 });
    expect(await assignTutor(f.admin.id, f.programId, [f.zed.id], f.admin.id)).toEqual({ assigned: 0, skipped: 1 }); // not in this program
    // A whole group at once; then a class.
    expect(await assignTutorToClass(f.admin.id, f.programId, { classId: f.c.id, groupId: f.gA.id, tutorId: f.rwTutor.id })).toEqual({ assigned: 1, skipped: 0 });
    expect(await outcome(() => assignTutorToClass(f.admin.id, f.programId, { classId: f.other.id, tutorId: f.admin.id }))).toBe("hidden");
    expect((await primaryTutorsOf(f.ana.id)).map((t) => t.tutor.name)).toEqual(["RW tutor"]);
    // The tutor got a notice.
    expect(await db.notification.count({ where: { userId: f.groupTutor.id, kind: "ATTENTION" } })).toBe(1);
    // Unassign.
    await assignTutor(f.admin.id, f.programId, [f.ana.id], null);
    expect(await primaryTutorsOf(f.ana.id)).toEqual([]);
  });

  it("CSV import: checks every row, then applies the good ones", async () => {
    const f = await fixture();
    const email = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).email;
    const csv = `student_email,tutor_email\n${await email(f.ben.id)},${await email(f.groupTutor.id)}\n${await email(f.ana.id)},${await email(f.groupTutor.id)}\nnobody@example.com,${await email(f.admin.id)}\n${await email(f.cal.id)},${(await email(f.viewer.id)).toUpperCase()}\n`;
    const check = await importCaseloadCsv(f.admin.id, f.programId, csv, false);
    expect(check).toMatchObject({ ready: 1, problems: 3, assigned: 0 });
    expect(check.rows.map((r) => r.problem)).toEqual([null, expect.stringMatching(/doesn't teach/), expect.stringMatching(/No student/), expect.stringMatching(/No teacher/)]);
    expect(await db.primaryTutor.count()).toBe(0);
    expect((await importCaseloadCsv(f.admin.id, f.programId, csv, true)).assigned).toBe(1);
    expect(await outcome(() => importCaseloadCsv(f.groupTutor.id, f.programId, csv, true))).toBe("hidden");
  });

  it("the caseload view: students, how many need attention, last contact; and the 'my caseload' filter", async () => {
    const f = await fixture();
    await assignTutor(f.admin.id, f.programId, [f.ben.id, f.cal.id], f.groupTutor.id);
    await db.user.update({ where: { id: f.ben.id }, data: { lastLoginAt: ago(15) } });
    await db.user.update({ where: { id: f.ana.id }, data: { lastLoginAt: ago(15) } });
    const t = await db.messageThread.create({ data: { classId: f.c.id, studentId: f.cal.id, staffId: f.groupTutor.id, lastMessageAt: ago(3) } });
    await db.message.create({ data: { threadId: t.id, authorId: f.groupTutor.id, body: "Hi" } });
    const v = await caseloadView(f.admin.id, f.programId, NOW);
    const load = v.loads.find((l) => l.tutor.id === f.groupTutor.id)!;
    expect(load.students.map((s) => [s.name, s.needs, s.lastContact?.toISOString() ?? null])).toEqual([
      ["Ben", 1, null],
      ["Cal", 0, ago(3).toISOString()],
    ]);
    expect(load.needing).toBe(1);
    expect(v.unassigned.map((s) => s.name)).toEqual(["Ana"]);
    expect(await outcome(() => caseloadView(f.groupTutor.id, f.programId, NOW))).toBe("hidden");
    // "My caseload": the group tutor's Ben; the admin's own caseload is empty.
    expect((await attentionList(f.groupTutor.id, { mine: true }, NOW)).items.map((i) => i.name)).toEqual(["Ben"]);
    expect((await attentionList(f.admin.id, { mine: true }, NOW)).items).toEqual([]);
  });
});
