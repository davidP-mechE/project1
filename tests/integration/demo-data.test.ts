import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { ClassError, classAccess } from "@/server/access";
import { NotFoundError } from "@/server/courses";
import { classProgress, createClass, joinClass } from "@/server/classes";
import { DEMO_CLASS_NAME, DEMO_MODE_DOMAIN, clearDemoData, demoStatus, loadDemoData } from "@/server/demo-data";
import { createUser, resetDb } from "../helpers/db";

/** Demo mode: a realistic invented class, flagged so it never mixes with real data and goes in one step. */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date("2026-11-11T15:00:00Z");

async function demoClass() {
  return db.class.findFirstOrThrow({ where: { isDemo: true, name: DEMO_CLASS_NAME }, include: { members: { include: { user: true } }, staff: true, assignments: true } });
}

describe("loading demo data", () => {
  it("creates one tutor, the class and 10 students, all flagged as demo", async () => {
    const r = await loadDemoData(NOW);
    expect(r.students).toBe(10);
    const users = await db.user.findMany({ where: { email: { endsWith: `@${DEMO_MODE_DOMAIN}` } } });
    expect(users).toHaveLength(11);
    expect(users.every((u) => u.isDemo && u.image?.startsWith("data:image/svg+xml"))).toBe(true);
    const c = await demoClass();
    expect(c.isDemo).toBe(true);
    expect(c.members).toHaveLength(10);
    expect(c.staff).toEqual([expect.objectContaining({ role: "TEACHER", userId: r.tutorEmail && users.find((u) => u.email === r.tutorEmail)!.id })]);
    expect(await db.program.count({ where: { isDemo: true } })).toBe(1);
    // Every book, course and worksheet a demo account owns is flagged too.
    expect(await db.course.count({ where: { user: { isDemo: true }, isDemo: false } })).toBe(0);
    expect(await db.book.count({ where: { user: { isDemo: true }, isDemo: false } })).toBe(0);
    expect(await db.worksheet.count({ where: { owner: { isDemo: true }, isDemo: false } })).toBe(0);
  });

  it("gives a 4-chapter course, progress that differs per student, and one student who never started", async () => {
    await loadDemoData(NOW);
    const c = await demoClass();
    const tutorCourse = await db.course.findFirstOrThrow({ where: { isDemo: true, classCourseId: null }, include: { units: true, lessons: true } });
    expect(tutorCourse.units).toHaveLength(4);
    expect(tutorCourse.lessons.length).toBeGreaterThanOrEqual(8);
    const done = new Map<string, number>();
    for (const m of c.members) done.set(m.user.name, await db.lessonProgress.count({ where: { userId: m.userId, completedAt: { not: null } } }));
    expect(new Set(done.values()).size).toBeGreaterThanOrEqual(4);
    expect([...done.values()].filter((n) => n === 8).length).toBe(2); // the two strong students finished
    expect([...done.values()].filter((n) => n === 0)).toHaveLength(1); // one never started
    const never = c.members.find((m) => done.get(m.user.name) === 0)!;
    expect(await db.course.count({ where: { userId: never.userId } })).toBe(0);
  });

  it("matches results to levels: strong students outscore struggling ones on quizzes, unit tests and scores", async () => {
    await loadDemoData(NOW);
    const avg = async (emails: string[]) => {
      const ids = (await db.user.findMany({ where: { email: { in: emails.map((e) => `${e}@${DEMO_MODE_DOMAIN}`) } }, select: { id: true } })).map((u) => u.id);
      const qa = await db.questionAttempt.findMany({ where: { userId: { in: ids } }, select: { correct: true } });
      const sc = await db.scoreRecord.findMany({ where: { studentId: { in: ids } }, select: { total: true } });
      return { acc: qa.filter((q) => q.correct).length / qa.length, score: sc.reduce((n, s) => n + s.total, 0) / sc.length };
    };
    const strong = await avg(["student1", "student2"]);
    const struggling = await avg(["student8", "student9"]);
    expect(strong.acc).toBeGreaterThan(struggling.acc);
    expect(strong.score).toBeGreaterThan(struggling.score + 150);
  });

  it("has an assignment everyone finished, one with late and missing work, and one due next week", async () => {
    const r = await loadDemoData(NOW);
    const tutor = await db.user.findUniqueOrThrow({ where: { email: r.tutorEmail } });
    const p = await classProgress(tutor.id, r.classId, NOW);
    const byTitle = (t: string) => {
      const a = p.assignments.find((x) => x.title === t)!;
      return p.students.map((s) => p.cells[`${s.id}:${a.id}`]);
    };
    expect(byTitle("Warm-up: linear equations").every((c) => c.status === "done" && !c.late)).toBe(true);
    const a2 = byTitle("Read chapters 1 and 2");
    expect(a2.filter((c) => c.status === "done" && c.late).length).toBe(2);
    expect(a2.filter((c) => c.status !== "done").length).toBe(3);
    expect(a2.filter((c) => c.status === "done" && !c.late).length).toBe(5);
    const a3 = p.assignments.find((x) => x.title === "Systems of equations practice")!;
    expect(a3.dueAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(byTitle("Systems of equations practice").filter((c) => c.status !== "not_started").length).toBe(3);
    expect(await db.diagnosticAttempt.count({ where: { finishedAt: { not: null }, user: { isDemo: true } } })).toBe(9);
  });

  it("includes tutor chats with student questions and replies", async () => {
    await loadDemoData(NOW);
    const threads = await db.tutorThread.findMany({ where: { user: { isDemo: true } }, include: { messages: true } });
    expect(threads.length).toBeGreaterThanOrEqual(3);
    for (const t of threads) expect(new Set(t.messages.map((m) => m.role))).toEqual(new Set(["USER", "ASSISTANT"]));
  });

  it("refuses to load twice, and on production unless allowed", async () => {
    await loadDemoData(NOW);
    await expect(loadDemoData(NOW)).rejects.toThrow(ClassError);
    await clearDemoData();
    vi.stubEnv("APP_ENV", "production");
    await expect(loadDemoData(NOW)).rejects.toThrow(/turned off/);
    expect((await demoStatus()).allowed).toBe(false);
    vi.stubEnv("DEMO_DATA_ALLOWED", "true");
    expect((await demoStatus()).allowed).toBe(true);
  });
});

describe("keeping demo and real data apart", () => {
  it("clearing removes every demo record and leaves real data alone", async () => {
    const teacher = await createUser("Real Teacher");
    const student = await createUser("Real Student");
    const real = await createClass(teacher.id, "Real class");
    await joinClass(student.id, real.joinCode);
    await db.scoreRecord.create({ data: { studentId: student.id, source: "PSAT", takenOn: new Date("2026-09-01"), total: 1100, rw: 550, math: 550, enteredById: teacher.id } });
    const before = { users: await db.user.count(), classes: await db.class.count(), scores: await db.scoreRecord.count() };

    await loadDemoData(NOW);
    expect(await db.user.count()).toBe(before.users + 11);
    const r = await clearDemoData();
    expect(r.removedUsers).toBe(11);

    expect(await db.user.count()).toBe(before.users);
    expect(await db.class.count()).toBe(before.classes);
    expect(await db.scoreRecord.count()).toBe(before.scores);
    for (const model of ["program", "class", "course", "book", "worksheet"] as const) {
      // @ts-expect-error every one of these models has isDemo
      expect(await db[model].count({ where: { isDemo: true } })).toBe(0);
    }
    expect(await db.tutorThread.count()).toBe(0);
    expect(await db.diagnostic.count()).toBe(0);
    expect(await db.classMember.count({ where: { classId: real.id, userId: student.id } })).toBe(1);
    expect((await demoStatus()).loaded).toBe(false);
  });

  it("a real student can't join the demo class, even with its code", async () => {
    const r = await loadDemoData(NOW);
    const student = await createUser("Real Student");
    await expect(joinClass(student.id, r.joinCode)).rejects.toThrow(/No class has that code/);
    expect(await db.classMember.count({ where: { userId: student.id } })).toBe(0);
  });

  it("real teachers and students can't see into the demo class", async () => {
    const r = await loadDemoData(NOW);
    const outsider = await createUser("Real Teacher");
    await expect(classAccess(outsider.id, r.classId, "view")).rejects.toThrow(NotFoundError);
  });
});
