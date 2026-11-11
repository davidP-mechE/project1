import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { classAccess, ClassError, memberWhere, type ClassAccess } from "./access";
import { staffForStudent } from "./scores";
import { studentInsights } from "./insights";
import { parseModules } from "./tracker";

/**
 * The 1600 Project tutor view: class heatmap, a student's practice-test
 * insights and logs, and comments. Every function starts from classAccess /
 * staffForStudent, so a tutor only ever sees students in their own classes
 * (and, for a group-limited specialist, their own groups). Anything else is
 * "not found". A specialist limited to some subjects sees only those skills.
 */

/** Domain ids (src/lib/sat/domains.ts) this person may see; null = all. Skill ids look like "math.algebra.<skill>". */
const skillVisible = (access: ClassAccess, skillId: string | null) => {
  if (!access.subjects || !skillId) return access.subjects === null;
  return access.subjects.has(skillId.split(".")[1]);
};

/** The last N finished logs per student. */
async function recentLogs(studentIds: string[], n: number) {
  const rows = await db.testAttempt.findMany({ where: { userId: { in: studentIds }, status: "complete" }, orderBy: [{ dateTaken: "desc" }, { createdAt: "desc" }], select: { id: true, userId: true } });
  const per = new Map<string, string[]>();
  for (const r of rows) {
    const list = per.get(r.userId) ?? [];
    if (list.length < n) per.set(r.userId, [...list, r.id]);
  }
  return per;
}

/**
 * Students × skills, shaded by miss rate over each student's last 3 finished
 * logs. Miss rate = misses on that skill per test (misses ÷ number of those
 * tests, at most 3). Only skills someone in view has missed are shown.
 */
export async function classHeatmap(userId: string, classId: string) {
  const access = await classAccess(userId, classId, "view");
  const members = await db.classMember.findMany({ where: memberWhere(access), orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true } } } });
  const students = members.map((m) => m.user);
  const logs = await recentLogs(students.map((s) => s.id), 3);
  const attemptIds = [...logs.values()].flat();
  const items = attemptIds.length ? await db.attemptItem.findMany({ where: { attemptId: { in: attemptIds }, result: { not: "correct" }, skillId: { not: null } }, select: { skillId: true, attempt: { select: { userId: true } } } }) : [];
  const counts = new Map<string, number>(); // `${student}:${skill}`
  const skillTotals = new Map<string, number>();
  for (const i of items) {
    if (!skillVisible(access, i.skillId)) continue;
    const k = `${i.attempt.userId}:${i.skillId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    skillTotals.set(i.skillId!, (skillTotals.get(i.skillId!) ?? 0) + 1);
  }
  const skillRows = await db.skill.findMany({ where: { id: { in: [...skillTotals.keys()] } }, select: { id: true, name: true, domain: true, section: true } });
  const skills = skillRows.sort((a, b) => (skillTotals.get(b.id) ?? 0) - (skillTotals.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const cells: Record<string, { rate: number; misses: number; tests: number } | null> = {};
  let max = 0;
  for (const s of students) {
    const tests = logs.get(s.id)?.length ?? 0;
    for (const k of skills) {
      if (!tests) {
        cells[`${s.id}:${k.id}`] = null;
        continue;
      }
      const misses = counts.get(`${s.id}:${k.id}`) ?? 0;
      const rate = misses / tests;
      max = Math.max(max, rate);
      cells[`${s.id}:${k.id}`] = { rate, misses, tests };
    }
  }
  return { access, students: students.map((s) => ({ ...s, tests: logs.get(s.id)?.length ?? 0 })), skills, cells, max };
}

/** One student's practice-test picture for staff in scope: insights, redo progress, recent logs with notes and comments. */
export async function studentPractice(userId: string, classId: string, studentId: string) {
  const access = await staffForStudent(userId, classId, studentId, "view");
  const [student, insights, redo, logs] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: studentId }, select: { id: true, name: true } }),
    studentInsights(studentId),
    db.attemptItem.groupBy({ by: ["redoStatus"], where: { attempt: { userId: studentId }, result: { not: "correct" } }, _count: true }),
    db.testAttempt.findMany({
      where: { userId: studentId },
      orderBy: [{ dateTaken: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, dateTaken: true, status: true, total: true, scoreRw: true, scoreMath: true, minutesUsed: true, notes: true, test: { select: { name: true } }, _count: { select: { items: true } }, comments: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } } },
    }),
  ]);
  // A subject-limited specialist sees only their skills.
  const visible = { ...insights, bySkill: insights.bySkill.filter((r) => skillVisible(access, r.skillId)), focus: insights.focus.filter((f) => skillVisible(access, f.skillId)) };
  const redoCounts = { to_redo: 0, redone_correct: 0, still_wrong: 0 };
  for (const r of redo) redoCounts[r.redoStatus] = r._count;
  return { access, student, insights: visible, redo: redoCounts, logs };
}

/** One logged attempt, read-only, for staff in scope. */
export async function tutorAttempt(userId: string, classId: string, attemptId: string) {
  const a = await db.testAttempt.findUnique({ where: { id: attemptId }, include: { test: true, items: { orderBy: [{ section: "desc" }, { module: "asc" }, { questionNumber: "asc" }], include: { skill: { select: { id: true, name: true } }, errorType: { select: { label: true } } } }, comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } }, user: { select: { id: true, name: true } } } });
  if (!a) throw new NotFoundError("Attempt not found");
  let access: ClassAccess;
  try {
    access = await staffForStudent(userId, classId, a.userId, "view");
  } catch (err) {
    if (err instanceof NotFoundError) throw new NotFoundError("Attempt not found");
    throw err;
  }
  return { ...a, modules: parseModules(a.test.modules), items: a.items.filter((i) => skillVisible(access, i.skillId) || !access.subjects), access };
}

/** Tutors (not read-only viewers) can comment on any logged attempt of a student in scope. The student sees it on their log. */
export async function addAttemptComment(userId: string, classId: string, attemptId: string, body: string) {
  const text = body.trim().slice(0, 2000);
  if (!text) throw new ClassError("Write a comment first.");
  const a = await db.testAttempt.findUnique({ where: { id: attemptId }, select: { userId: true } });
  if (!a) throw new NotFoundError("Attempt not found");
  try {
    await staffForStudent(userId, classId, a.userId, "teach");
  } catch (err) {
    if (err instanceof NotFoundError) throw new NotFoundError("Attempt not found");
    throw err;
  }
  return db.attemptComment.create({ data: { attemptId, authorId: userId, body: text } });
}
