import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { TwoFactorRequiredError, needsStaffTwoFactor } from "@/server/access";
import { answerQuestion, assignQuestions, assignmentReport, createClass, getClassForTeacher } from "@/server/classes";
import { deleteWorksheetItem, getWorksheet, updateWorksheetItem } from "@/server/worksheets";
import { regradeQuestion } from "@/server/grade-review";
import { addStaff, resetStaffTwoFactor } from "@/server/staff";
import { getProgram, updateProgram } from "@/server/programs";
import { assertAiBudget, LimitError, programAiUsdToday } from "@/server/limits";
import { createUser, resetDb } from "../helpers/db";

const sent: { to: string; subject: string }[] = [];
vi.mock("@/server/email", () => ({
  sendEmail: async (m: { to: string; subject: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

async function classWithStudent() {
  const [admin, student] = await Promise.all([createUser("Admin"), createUser("Student")]);
  const c = await createClass(admin.id, "SAT Fall");
  await db.classMember.create({ data: { classId: c.id, userId: student.id } });
  return { admin, student, c };
}

describe("two-factor login for staff", () => {
  it("staff without two-factor can't open student data; students and non-staff aren't affected", async () => {
    vi.stubEnv("STAFF_TWO_FACTOR", "required");
    const { admin, student, c } = await classWithStudent();
    const specialist = await createUser("Spec");
    await db.classStaff.create({ data: { classId: c.id, userId: specialist.id, role: "SPECIALIST", sections: ["MATH"] } });
    expect(await needsStaffTwoFactor(admin.id)).toBe(true);
    expect(await needsStaffTwoFactor(specialist.id)).toBe(true);
    expect(await needsStaffTwoFactor(student.id)).toBe(false);
    await expect(getClassForTeacher(admin.id, c.id)).rejects.toBeInstanceOf(TwoFactorRequiredError);
    await expect(getClassForTeacher(specialist.id, c.id)).rejects.toBeInstanceOf(TwoFactorRequiredError);
    await expect(getProgram(admin.id, c.programId)).rejects.toBeInstanceOf(TwoFactorRequiredError);
    // Someone with no access still gets "not found", not a hint the class exists.
    await expect(getClassForTeacher(student.id, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await db.user.updateMany({ where: { id: { in: [admin.id, specialist.id] } }, data: { twoFactorEnabled: true } });
    expect(await needsStaffTwoFactor(admin.id)).toBe(false);
    await expect(getClassForTeacher(admin.id, c.id)).resolves.toBeTruthy();
    await expect(getClassForTeacher(specialist.id, c.id)).resolves.toBeTruthy();
  });

  it("only the program admin can reset a staff member's two-factor; it logs them out and is audited", async () => {
    const { admin, c } = await classWithStudent();
    const [teacher, other] = await Promise.all([createUser("Teacher"), createUser("Other")]);
    await db.classStaff.create({ data: { classId: c.id, userId: teacher.id, role: "TEACHER", canManageStaff: true } });
    await db.classStaff.create({ data: { classId: c.id, userId: other.id, role: "VIEWER" } });
    await db.user.update({ where: { id: other.id }, data: { twoFactorEnabled: true, twoFactors: { create: { id: "tf1", secret: "x", backupCodes: "y" } } } });
    await db.session.create({ data: { id: "s1", userId: other.id, token: "tok", expiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(resetStaffTwoFactor(teacher.id, c.id, other.id)).rejects.toThrow("Only the program admin");
    await resetStaffTwoFactor(admin.id, c.id, other.id);
    expect(await db.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ twoFactorEnabled: false });
    expect(await db.twoFactor.count({ where: { userId: other.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: other.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "staff.reset-2fa" } })).toBe(1);
  });
});

describe("rate limits", () => {
  it("limits staff invitations per person per day", async () => {
    const { admin, c } = await classWithStudent();
    for (let i = 0; i < 40; i++) await addStaff(admin.id, c.id, `t${i}@school.org`, { role: "VIEWER" });
    await expect(addStaff(admin.id, c.id, "one-more@school.org", { role: "VIEWER" })).rejects.toThrow("a lot of staff today");
  });
});

describe("program AI spending cap", () => {
  it("pauses AI for everyone in the program once today's spend reaches the cap, and emails the admin once", async () => {
    const { admin, student, c } = await classWithStudent();
    const outsider = await createUser("Not in it");
    await updateProgram(admin.id, c.programId, { aiDailyCapCents: 100 }); // $1
    await assertAiBudget(student.id);
    await db.usageEvent.create({ data: { userId: student.id, feature: "GRADING", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 600_000 } });
    await db.usageEvent.create({ data: { userId: admin.id, feature: "WORKSHEET", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 400_000 } });
    // Yesterday's spend doesn't count.
    await db.usageEvent.create({ data: { userId: student.id, feature: "GRADING", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 500_000, createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await programAiUsdToday(c.programId)).toBeCloseTo(1);
    await expect(assertAiBudget(student.id)).rejects.toBeInstanceOf(LimitError);
    await expect(assertAiBudget(admin.id)).rejects.toThrow("daily AI limit ($1.00)");
    await expect(assertAiBudget(outsider.id)).resolves.toBeUndefined();
    expect(sent.filter((m) => m.subject.includes("daily AI cap reached"))).toHaveLength(1);
    // A higher cap lets it continue.
    await updateProgram(admin.id, c.programId, { aiDailyCapCents: 500 });
    await expect(assertAiBudget(student.id)).resolves.toBeUndefined();
  });
});

describe("question versions", () => {
  async function answered() {
    const { admin, student, c } = await classWithStudent();
    const ws = await db.worksheet.create({
      data: {
        ownerId: admin.id,
        title: "Quiz",
        fileKey: "k",
        sizeBytes: BigInt(1),
        status: "READY",
        items: {
          create: [
            { order: 0, label: "1", type: "MULTIPLE_CHOICE", prompt: "2 + 2?", choices: ["3", "4", "5"], correctChoice: 2, answer: "5", explanation: "", topic: "Arithmetic" },
            { order: 1, label: "2", type: "SHORT_ANSWER", prompt: "Capital of France?", answer: "Paris", explanation: "", topic: "Geography" },
          ],
        },
      },
      include: { items: { orderBy: { order: "asc" } } },
    });
    const [a] = await assignQuestions(admin.id, { classIds: [c.id], worksheetId: ws.id, itemIds: [], title: "Quiz" });
    // The key is wrong (it says 5): the student answers 4 and is marked wrong.
    await answerQuestion(student.id, a.id, ws.items[0].id, { choice: 1 }, { grader: null });
    return { admin, student, c, ws, a, mc: ws.items[0], written: ws.items[1] };
  }

  it("editing an answered question makes a new version and keeps past grades", async () => {
    const { admin, ws, a, mc } = await answered();
    const before = await db.assignmentAnswer.findFirstOrThrow({ where: { itemId: mc.id } });
    expect(before).toMatchObject({ correct: false, itemVersion: 1 });
    await updateWorksheetItem(admin.id, mc.id, { type: "MULTIPLE_CHOICE", prompt: "2 + 2?", choices: ["3", "4", "5"], correctChoice: 1, answer: "", explanation: "Two and two make four.", topic: "Arithmetic" });
    const item = await db.worksheetItem.findUniqueOrThrow({ where: { id: mc.id }, include: { versions: true } });
    expect(item.version).toBe(2);
    expect(item.versions).toEqual([expect.objectContaining({ version: 1, correctChoice: 2, answer: "5", editedById: admin.id })]);
    // The student's grade hasn't changed.
    expect(await db.assignmentAnswer.findFirstOrThrow({ where: { itemId: mc.id } })).toMatchObject({ correct: false, score: 0, itemVersion: 1 });
    const report = await assignmentReport(admin.id, a.id);
    expect(report.questions[0]).toMatchObject({ version: 2, olderAnswers: 1 });
    // Changing only the skill name doesn't make a new version.
    await updateWorksheetItem(admin.id, mc.id, { type: "MULTIPLE_CHOICE", prompt: "2 + 2?", choices: ["3", "4", "5"], correctChoice: 1, answer: "", explanation: "Two and two make four.", topic: "Adding" });
    expect((await db.worksheetItem.findUniqueOrThrow({ where: { id: mc.id } })).version).toBe(2);
    // An unanswered question is edited in place.
    await updateWorksheetItem(admin.id, ws.items[1].id, { type: "SHORT_ANSWER", prompt: "Capital of Italy?", choices: [], correctChoice: null, answer: "Rome", explanation: "", topic: "Geography" });
    expect((await db.worksheetItem.findUniqueOrThrow({ where: { id: ws.items[1].id } })).version).toBe(1);
  });

  it("re-grading is an explicit, audited step that only staff in scope can take", async () => {
    const { admin, student, c, a, mc } = await answered();
    await updateWorksheetItem(admin.id, mc.id, { type: "MULTIPLE_CHOICE", prompt: "2 + 2?", choices: ["3", "4", "5"], correctChoice: 1, answer: "", explanation: "", topic: "Arithmetic" });
    const rw = await createUser("RW spec");
    await db.classStaff.create({ data: { classId: c.id, userId: rw.id, role: "SPECIALIST", sections: ["RW"] } });
    await expect(regradeQuestion(rw.id, a.id, mc.id)).rejects.toBeInstanceOf(NotFoundError); // untagged work is outside a subject scope
    await expect(regradeQuestion(student.id, a.id, mc.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await regradeQuestion(admin.id, a.id, mc.id)).toEqual({ checked: 1, changed: 1, needsReview: 0 });
    expect(await db.assignmentAnswer.findFirstOrThrow({ where: { itemId: mc.id } })).toMatchObject({ correct: true, score: 1, itemVersion: 2 });
    expect(await db.auditLog.count({ where: { action: "question.regrade" } })).toBe(1);
    expect((await assignmentReport(admin.id, a.id)).questions[0].olderAnswers).toBe(0);
  });

  it("deleting an answered question archives it, so answers and grades stay", async () => {
    const { admin, ws, mc, written } = await answered();
    await deleteWorksheetItem(admin.id, mc.id);
    await deleteWorksheetItem(admin.id, written.id);
    expect(await db.worksheetItem.findUnique({ where: { id: mc.id } })).toMatchObject({ archivedAt: expect.any(Date) });
    expect(await db.worksheetItem.findUnique({ where: { id: written.id } })).toBeNull(); // never answered: really deleted
    expect(await db.assignmentAnswer.count({ where: { itemId: mc.id } })).toBe(1);
    expect((await getWorksheet(admin.id, ws.id)).items).toHaveLength(0);
  });
});
