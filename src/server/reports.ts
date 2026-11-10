import "server-only";
import { db } from "./db";
import { myScores, studentScoresForStaff, classScores } from "./scores";
import { planFor } from "./pacing";
import { domainAccuracyFor } from "./trends";
import { myBadges } from "./badges";
import { classAccess, studentIdsInScope } from "./access";
import { domainName } from "@/lib/sat/domains";

/**
 * Printable reports ("Save as PDF" from the browser): a student's progress
 * report and a class summary. Scoped exactly like the screens they come from:
 * a student gets their own; staff get students and classes in their scope,
 * in the subjects they cover.
 */

async function attendanceFor(studentId: string, classIds: string[] | null) {
  const rows = await db.attendanceRecord.findMany({ where: { studentId, ...(classIds ? { session: { classId: { in: classIds } } } : {}) }, select: { status: true } });
  const marked = rows.filter((r) => r.status !== "EXCUSED").length;
  const attended = rows.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
  return { marked, attended };
}

async function mistakesFor(studentId: string, subjects: Set<string> | null) {
  const open = await db.mistakeItem.groupBy({ by: ["domain"], where: { studentId, retiredAt: null }, _count: { _all: true } });
  return open
    .filter((o) => !subjects || (o.domain !== null && subjects.has(o.domain)))
    .map((o) => ({ name: domainName(o.domain), open: o._count._all }))
    .sort((a, b) => b.open - a.open);
}

/** A student's own progress report. */
export async function myProgressReport(userId: string, now = new Date()) {
  const [user, h, domains, attendance, mistakes, plan, badges, classes] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    myScores(userId, now),
    domainAccuracyFor([userId], null, 90, now),
    attendanceFor(userId, null),
    mistakesFor(userId, null),
    planFor(userId, now),
    myBadges(userId),
    db.classMember.findMany({ where: { userId, class: { archivedAt: null } }, select: { class: { select: { name: true, program: { select: { name: true, badge: true } } } } } }),
  ]);
  return { studentName: user.name, context: classes.map((c) => `${c.class.program.name} · ${c.class.name}`), programs: classes.map((c) => c.class.program), history: h, domains, attendance, mistakes, plan, badges, subjectsNote: null as string | null };
}

/** A student's progress report for staff in scope (not found otherwise). */
export async function staffProgressReport(viewerId: string, classId: string, studentId: string, now = new Date()) {
  const s = await studentScoresForStaff(viewerId, classId, studentId, now);
  const [domains, attendance, mistakes, plan, badges, c] = await Promise.all([
    domainAccuracyFor([studentId], s.access.subjects, 90, now),
    attendanceFor(studentId, [classId]),
    mistakesFor(studentId, s.access.subjects),
    planFor(studentId, now),
    myBadges(studentId),
    db.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, program: { select: { name: true, badge: true } } } }),
  ]);
  return {
    studentName: s.student.name,
    context: [`${c.program.name} · ${c.name}`],
    programs: [c.program],
    history: s,
    domains,
    attendance,
    mistakes,
    plan,
    badges,
    subjectsNote: s.access.subjects ? "Only the subjects you cover are shown." : null,
  };
}

/** A class summary for staff, in their scope. */
export async function classSummaryReport(viewerId: string, classId: string, now = new Date()) {
  const access = await classAccess(viewerId, classId, "view");
  const [scores, ids, c] = await Promise.all([
    classScores(viewerId, classId, {}, now),
    studentIdsInScope(access),
    db.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, program: { select: { name: true, badge: true } } } }),
  ]);
  const [domains, attendance] = await Promise.all([
    domainAccuracyFor(ids, access.subjects, 90, now),
    db.attendanceRecord.findMany({ where: { studentId: { in: ids }, session: { classId } }, select: { status: true } }),
  ]);
  const marked = attendance.filter((r) => r.status !== "EXCUSED").length;
  const attended = attendance.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
  return { className: c.name, program: c.program, access, stats: scores.stats, targets: scores.targets, students: scores.students, domains, attendance: { marked, attended }, scoped: access.groupIds.length > 0 || access.subjects !== null };
}
