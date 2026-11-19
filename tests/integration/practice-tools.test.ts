import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass, myClasses } from "@/server/classes";
import { assignSetToClasses } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { approveBatch, autoBatchView, buildBatch, buildWeeklyBatches, removeQuestion, setItemRemoved, swapQuestion } from "@/server/auto-practice";
import { classSmallGroups, messageSmallGroup, programSmallGroups, sessionForSmallGroup, assignSmallGroup } from "@/server/small-groups";
import { answerLive, closeLive, joinByCode, openRunsFor, revealLive, staffLiveView, startLiveRun, studentLiveView } from "@/server/live";
import { listSets, practiceCatalog, startPractice } from "@/server/bank";
import { ensureReferenceData } from "@/server/seed/reference";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

const DAY = 86_400_000;
const NOW = new Date("2026-11-18T15:00:00Z"); // a Wednesday
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const BOUNDARIES = "rw.conventions.boundaries";
const TRANSITIONS = "rw.expression.transitions";
const LINEAR = "math.algebra.linear-equations-in-one-variable";

beforeEach(async () => {
  await resetDb();
  await ensureReferenceData({ onlyIfEmpty: false });
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

async function questions(skillId: string, n: number, author: string) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await db.bankQuestion.create({ data: { section: skillId.startsWith("math") ? "math" : "rw", skillId, type: "mcq", stem: `${skillId} question ${i}`, choices: ["a", "b", "c", "d"], answer: "A", difficulty: 1 + (i % 3), status: "published", authorId: author } }));
  return out;
}

const miss = (userId: string, questionId: string, daysAgo = 3) => db.bankAttempt.create({ data: { userId, questionId, questionVersion: 1, answerGiven: "B", correct: false, createdAt: ago(daysAgo) } });

/** Admin; a group-B specialist; a Math-only specialist; Ana (group A), Ben and Cal (group B); an outsider with their own class. */
async function fixture() {
  const [admin, groupTutor, mathTutor, outsider, ana, ben, cal, zed] = await Promise.all(["Admin", "Group tutor", "Math tutor", "Outsider", "Ana", "Ben", "Cal", "Zed"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gA = await createGroup(admin.id, c.id, "A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "B", [ben.id, cal.id]);
  await db.classStaff.createMany({ data: [{ classId: c.id, userId: groupTutor.id, role: "SPECIALIST", groupIds: [gB.id] }, { classId: c.id, userId: mathTutor.id, role: "SPECIALIST", sections: ["MATH"] }] });
  const other = await createClass(outsider.id, "Other");
  await db.classMember.create({ data: { classId: other.id, userId: zed.id } });
  const qB = await questions(BOUNDARIES, 12, admin.id);
  const qT = await questions(TRANSITIONS, 6, admin.id);
  const qL = await questions(LINEAR, 10, admin.id);
  return { c, other, admin, groupTutor, mathTutor, outsider, ana, ben, cal, zed, gA, gB, qB, qT, qL, programId: c.programId! };
}

describe("weekly auto-assigned practice", () => {
  it("builds a set per student from their weakest skills, leaving out recently-correct questions; once a week", async () => {
    const f = await fixture();
    for (const q of f.qB.slice(0, 3)) await miss(f.ben.id, q.id);
    for (const q of f.qT.slice(0, 3)) await miss(f.ben.id, q.id); // a weak skill needs 3+ answers (or logged misses)
    await db.bankAttempt.create({ data: { userId: f.ben.id, questionId: f.qB[5].id, questionVersion: 1, answerGiven: "A", correct: true, createdAt: ago(2) } });
    for (const q of f.qL.slice(0, 3)) await miss(f.ana.id, q.id);
    const r = await buildBatch(f.c.id, NOW);
    expect(r).toMatchObject({ created: true, made: 2, skipped: 1 }); // Cal has no practice data
    const items = await db.autoPracticeItem.findMany({ include: { student: true } });
    const ben = items.find((i) => i.student.name === "Ben")!;
    expect(ben.questionIds).toHaveLength(10);
    expect(ben.skillIds).toEqual([BOUNDARIES, TRANSITIONS]);
    expect(ben.questionIds).not.toContain(f.qB[5].id);
    // The worker builds only missing batches.
    expect(await buildWeeklyBatches(NOW)).toBe(1); // the outsider's class (Zed has no data, but it gets an empty batch)
    expect(await buildWeeklyBatches(NOW)).toBe(0);
    expect(await buildWeeklyBatches(new Date(NOW.getTime() + 7 * DAY))).toBe(2); // next week
    // Staff got a notice to review it.
    expect(await db.notification.count({ where: { userId: f.admin.id, kind: "REVIEW" } })).toBeGreaterThan(0);
  });

  it("scope: staff see their own students; specialists act only inside their subjects; outsiders see nothing", async () => {
    const f = await fixture();
    for (const q of f.qB.slice(0, 3)) await miss(f.ben.id, q.id);
    for (const q of f.qL.slice(0, 3)) await miss(f.ana.id, q.id);
    await buildBatch(f.c.id, NOW);
    expect((await autoBatchView(f.admin.id, f.c.id, {}, NOW)).items.map((i) => i.student.name)).toEqual(["Ana", "Ben"]);
    expect((await autoBatchView(f.groupTutor.id, f.c.id, {}, NOW)).items.map((i) => i.student.name)).toEqual(["Ben"]);
    const mathView = await autoBatchView(f.mathTutor.id, f.c.id, {}, NOW);
    const benForMath = mathView.items.find((i) => i.student.name === "Ben")!;
    expect(benForMath).toMatchObject({ canAct: false, questions: [] }); // a Reading and Writing set
    expect(mathView.items.find((i) => i.student.name === "Ana")!.canAct).toBe(true);
    expect(await outcome(() => autoBatchView(f.outsider.id, f.c.id, {}, NOW))).toBe("hidden");
    const item = await db.autoPracticeItem.findFirstOrThrow({ where: { studentId: f.ben.id } });
    expect(await outcome(() => removeQuestion(f.mathTutor.id, item.id, item.questionIds[0]))).toBe("denied");
    const anaItem = await db.autoPracticeItem.findFirstOrThrow({ where: { studentId: f.ana.id } });
    expect(await outcome(() => removeQuestion(f.groupTutor.id, anaItem.id, anaItem.questionIds[0]))).toBe("hidden");
  });

  it("remove and swap questions, take a student out, then approve all: sets become assignments for each student", async () => {
    const f = await fixture();
    for (const q of f.qB.slice(0, 3)) await miss(f.ben.id, q.id);
    for (const q of f.qB.slice(0, 3)) await miss(f.cal.id, q.id);
    for (const q of f.qL.slice(0, 3)) await miss(f.ana.id, q.id);
    await buildBatch(f.c.id, NOW);
    const ben = await db.autoPracticeItem.findFirstOrThrow({ where: { studentId: f.ben.id } });
    await removeQuestion(f.admin.id, ben.id, ben.questionIds[0]);
    const swapped = await swapQuestion(f.admin.id, ben.id, ben.questionIds[1], NOW);
    const after = await db.autoPracticeItem.findUniqueOrThrow({ where: { id: ben.id } });
    expect(after.questionIds).toHaveLength(9);
    expect(after.questionIds).toContain(swapped);
    expect(after.questionIds).not.toContain(ben.questionIds[1]);
    const cal = await db.autoPracticeItem.findFirstOrThrow({ where: { studentId: f.cal.id } });
    await setItemRemoved(f.admin.id, cal.id, true);
    // The group tutor approves: only Ben (group B, in scope); Ana's waits for someone who teaches her.
    const batch = await db.autoPracticeBatch.findFirstOrThrow();
    expect(await outcome(() => approveBatch(f.groupTutor.id, f.c.id, { batchId: batch.id, dueAt: ago(1) }, NOW))).toBe("invalid");
    expect(await approveBatch(f.groupTutor.id, f.c.id, { batchId: batch.id, dueAt: new Date(NOW.getTime() + 7 * DAY) }, NOW)).toEqual({ approved: 1 });
    expect((await approveBatch(f.admin.id, f.c.id, { batchId: batch.id, dueAt: new Date(NOW.getTime() + 7 * DAY) }, NOW)).approved).toBe(1);
    // Ben's set is his assignment only; it's hidden from the bank's lists and the catalog.
    const benA = (await myClasses(f.ben.id, NOW))[0].assignments.map((a) => a.title);
    expect(benA).toEqual([expect.stringMatching(/^Practice for Ben · week of Nov 16/)]);
    expect((await myClasses(f.ana.id, NOW))[0].assignments).toHaveLength(1);
    expect((await myClasses(f.cal.id, NOW))[0].assignments).toHaveLength(0);
    const set = await db.questionSet.findFirstOrThrow({ where: { autoForStudentId: f.ben.id } });
    const a = await db.assignment.findFirstOrThrow({ where: { questionSetId: set.id } });
    expect(a.studentIds).toEqual([f.ben.id]);
    await startPractice(f.ben.id, set.id, { assignmentId: a.id });
    expect(await outcome(() => startPractice(f.cal.id, set.id, { assignmentId: a.id }))).toBe("hidden");
    await db.user.update({ where: { id: f.admin.id }, data: { role: "TUTOR" } });
    expect((await listSets(f.admin.id)).some((s) => s.id === set.id)).toBe(false);
    expect((await practiceCatalog(f.admin.id)).some((s) => s.id === set.id)).toBe(false);
  });
});

describe("suggested small groups", () => {
  async function weakOn(f: Awaited<ReturnType<typeof fixture>>) {
    for (const s of [f.ana, f.ben, f.cal]) for (const q of f.qB.slice(0, 3)) await miss(s.id, q.id);
    for (const q of f.qT.slice(0, 5)) await miss(f.cal.id, q.id); // Cal's weakest is Transitions
  }

  it("groups students by their weakest skill, with size and accuracy, inside the viewer's scope", async () => {
    const f = await fixture();
    await weakOn(f);
    const g = (await classSmallGroups(f.admin.id, f.c.id, NOW)).groups;
    expect(g.map((x) => [x.skill, x.students.map((s) => s.name)])).toEqual([
      ["Boundaries", ["Ana", "Ben"]],
      ["Transitions", ["Cal"]],
    ]);
    expect(g[0].accuracy).toBe(0);
    expect((await classSmallGroups(f.groupTutor.id, f.c.id, NOW)).groups.flatMap((x) => x.students.map((s) => s.name)).sort()).toEqual(["Ben", "Cal"]);
    expect((await classSmallGroups(f.mathTutor.id, f.c.id, NOW)).groups).toEqual([]); // no Math weakness
    expect(await outcome(() => classSmallGroups(f.outsider.id, f.c.id, NOW))).toBe("hidden");
    expect((await programSmallGroups(f.admin.id, f.programId, NOW)).groups[0].students).toHaveLength(2);
    expect(await outcome(() => programSmallGroups(f.groupTutor.id, f.programId, NOW))).toBe("hidden");
  });

  it("message, assign and session actions stay inside scope", async () => {
    const f = await fixture();
    await weakOn(f);
    // The group tutor can't reach Ana; with only her chosen, nothing is in scope.
    expect(await outcome(() => messageSmallGroup(f.groupTutor.id, { classIds: [f.c.id], studentIds: [f.ana.id], body: "Hi" }, NOW))).toBe("invalid");
    expect(await messageSmallGroup(f.groupTutor.id, { classIds: [f.c.id], studentIds: [f.ana.id, f.ben.id], body: "Boundaries clinic Thursday" }, NOW)).toEqual({ sent: 1 });
    const set = await db.questionSet.create({ data: { title: "Boundaries", questionIds: f.qB.map((q) => q.id), skillIds: [BOUNDARIES], status: "published", visibility: "class" } });
    expect(await assignSmallGroup(f.admin.id, { classIds: [f.c.id], studentIds: [f.ana.id, f.ben.id], setId: set.id, dueAt: null })).toEqual({ assigned: 2 });
    expect((await myClasses(f.cal.id, NOW))[0].assignments).toHaveLength(0);
    // Sessions need someone who manages the class (it makes a group).
    expect(await outcome(() => sessionForSmallGroup(f.groupTutor.id, { classId: f.c.id, studentIds: [f.ben.id], skill: "Boundaries", startsAt: NOW.toISOString(), minutes: 30 }))).toBe("denied");
    await sessionForSmallGroup(f.admin.id, { classId: f.c.id, studentIds: [f.ana.id, f.ben.id], skill: "Boundaries", startsAt: NOW.toISOString(), minutes: 30 });
    const g = await db.classGroup.findFirstOrThrow({ where: { name: { startsWith: "Small group: Boundaries" } }, include: { members: true } });
    expect(g.members.map((m) => m.userId).sort()).toEqual([f.ana.id, f.ben.id].sort());
    expect(await db.classSession.count({ where: { groupId: g.id } })).toBe(1);
  });
});

describe("live warm-ups and exit tickets", () => {
  async function liveSet(f: Awaited<ReturnType<typeof fixture>>) {
    return db.questionSet.create({ data: { title: "Warm-up", questionIds: f.qB.slice(0, 3).map((q) => q.id), skillIds: [BOUNDARIES], status: "published", visibility: "class" } });
  }

  it("students join by code, answer once, and see answers only when revealed; staff see live counts", async () => {
    const f = await fixture();
    const set = await liveSet(f);
    const run = await startLiveRun(f.admin.id, f.c.id, { setId: set.id, kind: "WARM_UP" });
    expect(run.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await joinByCode(f.ana.id, run.code.toLowerCase())).toBe(run.id);
    expect(await outcome(() => joinByCode(f.zed.id, run.code))).toBe("hidden");
    expect((await openRunsFor(f.ben.id)).map((r) => r.id)).toEqual([run.id]);
    const [q1, q2] = set.questionIds;
    await answerLive(f.ana.id, run.id, q1, "A", NOW);
    await answerLive(f.ben.id, run.id, q1, "C", NOW);
    expect(await outcome(() => answerLive(f.ben.id, run.id, q1, "A", NOW))).toBe("invalid"); // once
    expect(await outcome(() => answerLive(f.zed.id, run.id, q1, "A", NOW))).toBe("hidden");
    const before = await studentLiveView(f.ana.id, run.id);
    expect(before.questions[0]).toMatchObject({ mine: { answer: "A", correct: null }, reveal: null });
    expect(JSON.stringify(before)).not.toContain("explanation\":\"");
    const staff = await staffLiveView(f.admin.id, run.id);
    expect(staff).toMatchObject({ eligible: 3, joined: 2 });
    expect(staff.questions[0]).toMatchObject({ answered: 2, correct: 1, counts: [{ answer: "A", n: 1 }, { answer: "B", n: 0 }, { answer: "C", n: 1 }, { answer: "D", n: 0 }] });
    await revealLive(f.admin.id, run.id, q1);
    expect((await studentLiveView(f.ana.id, run.id)).questions[0]).toMatchObject({ mine: { correct: true }, reveal: { answer: "A" } });
    expect((await studentLiveView(f.ana.id, run.id)).questions[1].reveal).toBeNull();
    expect(await outcome(() => answerLive(f.cal.id, run.id, q1, "A", NOW))).toBe("invalid"); // already revealed
    // Every answer is also a practice attempt.
    expect(await db.bankAttempt.count({ where: { setId: set.id } })).toBe(2);
    // Closing files it under a new session and marks who answered as present.
    await answerLive(f.cal.id, run.id, q2, "A", NOW);
    const { sessionId } = await closeLive(f.admin.id, run.id, NOW);
    const marks = await db.attendanceRecord.findMany({ where: { sessionId: sessionId! } });
    expect(marks.map((m) => m.studentId).sort()).toEqual([f.ana.id, f.ben.id, f.cal.id].sort());
    expect(await outcome(() => answerLive(f.ana.id, run.id, q2, "A", NOW))).toBe("invalid");
    expect((await studentLiveView(f.ana.id, run.id)).questions.every((q) => q.reveal)).toBe(true);
  });

  it("a group tutor's run is for their groups; others can't see, start or reveal outside scope", async () => {
    const f = await fixture();
    const set = await liveSet(f);
    const run = await startLiveRun(f.groupTutor.id, f.c.id, { setId: set.id, kind: "EXIT_TICKET" });
    expect(run.groupIds).toEqual([f.gB.id]);
    expect(await outcome(() => joinByCode(f.ana.id, run.code))).toBe("hidden");
    expect((await staffLiveView(f.groupTutor.id, run.id)).eligible).toBe(2);
    expect(await outcome(() => staffLiveView(f.outsider.id, run.id))).toBe("hidden");
    expect(await outcome(() => revealLive(f.outsider.id, run.id, "all"))).toBe("hidden");
    expect(await outcome(() => startLiveRun(f.outsider.id, f.c.id, { setId: set.id }))).toBe("hidden");
    expect(await outcome(() => startLiveRun(f.groupTutor.id, f.c.id, { setId: set.id, groupIds: [f.gA.id] }))).toBe("denied");
    const priv = await db.questionSet.create({ data: { title: "Private", questionIds: set.questionIds, status: "published", visibility: "private" } });
    expect(await outcome(() => startLiveRun(f.admin.id, f.c.id, { setId: priv.id }))).toBe("invalid");
  });
});

describe("assigning a set to several classes", () => {
  it("assigns to every class the person teaches, or to none", async () => {
    const f = await fixture();
    const second = await createClass(f.admin.id, "SAT Spring", f.programId);
    const set = await db.questionSet.create({ data: { title: "Week 3", questionIds: f.qL.map((q) => q.id), status: "published", visibility: "class" } });
    expect(await outcome(() => assignSetToClasses(f.admin.id, { setId: set.id, classIds: [f.c.id, f.other.id] }))).toBe("hidden");
    expect(await db.assignment.count()).toBe(0);
    expect(await assignSetToClasses(f.admin.id, { setId: set.id, classIds: [f.c.id, second.id], dueAt: new Date(NOW.getTime() + 3 * DAY) })).toHaveLength(2);
    // A group tutor's "whole class" is their group.
    const [a] = await assignSetToClasses(f.groupTutor.id, { setId: set.id, classIds: [f.c.id] });
    expect(a.groupIds).toEqual([f.gB.id]);
  });
});
