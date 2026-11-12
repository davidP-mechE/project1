import { beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers read the session from cookies; here the "signed-in" user is set per test.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/server/session", () => ({
  getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
  requireUser: async () => ({ id: session.userId }),
  viewerZone: async () => "UTC",
}));
vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { assignLogTest, assignQuestionSet, classProgress, createClass, leaveClass, myClasses } from "@/server/classes";
import * as tracker from "@/server/tracker";
import * as bank from "@/server/bank";
import { addAttemptComment, classHeatmap, studentPractice, tutorAttempt } from "@/server/tutor-view";
import { syncOwnerRole } from "@/server/roles";
import { ensureReferenceData, SEED_TESTS } from "@/server/seed/reference";
import { GET as practiceRoute } from "@/app/api/classes/[classId]/students/[studentId]/practice/route";
import { createUser, resetDb } from "../helpers/db";

const ALG = "math.algebra.linear-equations-in-one-variable";
const WIC = "rw.craft-structure.words-in-context";
const T4 = SEED_TESTS[0].id;
const call = (classId: string, studentId: string) => practiceRoute(new Request("http://localhost/x"), { params: Promise.resolve({ classId, studentId }) } as never);

async function logFor(userId: string, items: tracker.ItemInput[], date = "2026-10-01") {
  const a = await tracker.startAttempt(userId, { testId: T4, dateTaken: date });
  await tracker.saveAttempt(userId, a.id, { scoreRw: 600, scoreMath: 600, items });
  await tracker.completeAttempt(userId, a.id);
  return a.id;
}

async function fixture() {
  const [tutorA, tutorB, s1, s2, mathSpec] = await Promise.all(["Tutor A", "Tutor B", "Sam", "Sky", "Math Spec"].map((n) => createUser(n)));
  const c1 = await createClass(tutorA.id, "Class A");
  const c2 = await createClass(tutorB.id, "Class B");
  await db.classMember.create({ data: { classId: c1.id, userId: s1.id } });
  await db.classMember.create({ data: { classId: c2.id, userId: s2.id } });
  await db.classStaff.create({ data: { classId: c1.id, userId: mathSpec.id, role: "SPECIALIST", sections: ["MATH"] } });
  return { tutorA, tutorB, s1, s2, mathSpec, c1, c2 };
}

describe("tutor view (The 1600 Project)", () => {
  beforeEach(async () => {
    await resetDb();
    await ensureReferenceData({ onlyIfEmpty: false });
    session.userId = null;
  });

  it("a tutor can't load a student outside their classes (API tested directly)", async () => {
    const f = await fixture();
    await logFor(f.s1.id, [{ section: "math", module: 1, questionNumber: 3, result: "wrong", skillId: ALG, errorTypeId: "careless" }]);
    await logFor(f.s2.id, [{ section: "math", module: 1, questionNumber: 4, result: "wrong", skillId: ALG, errorTypeId: "careless" }]);

    session.userId = f.tutorA.id;
    const ok = await call(f.c1.id, f.s1.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()).insights.totals.misses).toBe(1);
    // Someone else's student, by their class or by Tutor A's own class: not found.
    expect((await call(f.c2.id, f.s2.id)).status).toBe(404);
    expect((await call(f.c1.id, f.s2.id)).status).toBe(404);
    // A student can't use the staff route, even for themselves.
    session.userId = f.s1.id;
    expect((await call(f.c1.id, f.s1.id)).status).toBe(404);
    session.userId = null;
    expect((await call(f.c1.id, f.s1.id)).status).toBe(404);

    await expect(studentPractice(f.tutorA.id, f.c2.id, f.s2.id)).rejects.toBeInstanceOf(NotFoundError);
    const theirs = await db.testAttempt.findFirstOrThrow({ where: { userId: f.s2.id } });
    await expect(tutorAttempt(f.tutorA.id, f.c1.id, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addAttemptComment(f.tutorA.id, f.c1.id, theirs.id, "hi")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("heatmap: students × skills, misses per test over the last 3 logs, scoped to the tutor's subjects", async () => {
    const f = await fixture();
    await logFor(f.s1.id, [{ section: "math", module: 1, questionNumber: 1, result: "wrong", skillId: ALG, errorTypeId: "careless" }], "2026-07-01"); // 4th most recent: dropped
    await logFor(f.s1.id, [{ section: "math", module: 1, questionNumber: 1, result: "wrong", skillId: ALG, errorTypeId: "careless" }, { section: "rw", module: 1, questionNumber: 2, result: "wrong", skillId: WIC, errorTypeId: "misread" }], "2026-08-01");
    await logFor(f.s1.id, [{ section: "math", module: 2, questionNumber: 5, result: "guessed", skillId: ALG, errorTypeId: "guessed" }], "2026-09-01");
    await logFor(f.s1.id, [], "2026-10-01");
    const h = await classHeatmap(f.tutorA.id, f.c1.id);
    expect(h.students.map((s) => [s.name, s.tests])).toEqual([["Sam", 3]]);
    expect(h.cells[`${f.s1.id}:${ALG}`]).toEqual({ rate: 2 / 3, misses: 2, tests: 3 });
    expect(h.cells[`${f.s1.id}:${WIC}`]).toEqual({ rate: 1 / 3, misses: 1, tests: 3 });
    const m = await classHeatmap(f.mathSpec.id, f.c1.id);
    expect(m.skills.map((s) => s.id)).toEqual([ALG]);
    await expect(classHeatmap(f.tutorB.id, f.c1.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("tutors comment on a logged attempt; the student sees it", async () => {
    const f = await fixture();
    const id = await logFor(f.s1.id, []);
    await addAttemptComment(f.tutorA.id, f.c1.id, id, "Nice pacing on module 2.");
    const mine = await tracker.getAttempt(f.s1.id, id);
    expect(mine.comments.map((c) => [c.body, c.author.name])).toEqual([["Nice pacing on module 2.", "Tutor A"]]);
  });

  it("log_test and question_set assignments, with completion and the calculator setting", async () => {
    const f = await fixture();
    const owner = await createUser("Owner");
    process.env.OWNER_EMAIL = owner.email;
    await syncOwnerRole();
    const q = await bank.createQuestion(owner.id, { section: "math", skill: "Linear equations in one variable", difficulty: 1, type: "grid-in", stem: "3/4?", answer: "3/4", explanation: "" }, { publish: true });
    const set = await bank.createSet(owner.id, { title: "Mini", questionIds: [q.id], visibility: "class" });
    await expect(assignQuestionSet(f.tutorA.id, f.c1.id, { setId: set.id })).rejects.toThrow(/published/);
    await bank.setSetStatus(owner.id, set.id, "published");

    const logA = await assignLogTest(f.tutorA.id, f.c1.id, { testId: T4, dueAt: "2099-01-01T00:00:00Z" });
    expect(logA.title).toBe("Log Bluebook Practice Test 4");
    const setA = await assignQuestionSet(f.tutorA.id, f.c1.id, { setId: set.id, calculator: "BY_HAND" });
    expect(setA.calculator).toBe("BY_HAND");
    await expect(assignLogTest(f.tutorB.id, f.c1.id, { testId: T4 })).rejects.toBeInstanceOf(NotFoundError);

    // A class-only set can't be played without the assignment, but can with it; the sitting carries the calculator setting.
    await expect(bank.startPractice(f.s1.id, set.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bank.startPractice(f.s2.id, set.id, { assignmentId: setA.id })).rejects.toBeInstanceOf(NotFoundError);
    const { sessionId } = await bank.startPractice(f.s1.id, set.id, { assignmentId: setA.id });
    expect((await bank.practiceState(f.s1.id, sessionId)).calculator).toBe("BY_HAND");

    let grid = await classProgress(f.tutorA.id, f.c1.id);
    expect(grid.cells[`${f.s1.id}:${logA.id}`].status).toBe("not_started");
    await bank.answerPractice(f.s1.id, sessionId, q.id, "0.75", 4);
    await bank.finishPractice(f.s1.id, sessionId);
    await logFor(f.s1.id, []);
    grid = await classProgress(f.tutorA.id, f.c1.id);
    expect(grid.cells[`${f.s1.id}:${logA.id}`]).toMatchObject({ status: "done", late: false });
    expect(grid.cells[`${f.s1.id}:${setA.id}`]).toMatchObject({ status: "done", score: 1, done: 1, total: 1 });
    const mine = await myClasses(f.s1.id);
    expect(mine[0].assignments.map((a) => [a.kind, a.cell.status])).toEqual(expect.arrayContaining([["LOG_TEST", "done"], ["QUESTION_SET", "done"]]));
  });

  it("a student who leaves a class keeps their history, and the tutor loses access", async () => {
    const f = await fixture();
    const id = await logFor(f.s1.id, [{ section: "math", module: 1, questionNumber: 3, result: "wrong", skillId: ALG, errorTypeId: "careless" }]);
    await leaveClass(f.s1.id, f.c1.id);
    expect((await tracker.getAttempt(f.s1.id, id)).items).toHaveLength(1);
    expect(await db.scoreRecord.count({ where: { studentId: f.s1.id } })).toBe(1);
    await expect(studentPractice(f.tutorA.id, f.c1.id, f.s1.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
