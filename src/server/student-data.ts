import "server-only";
import { db } from "./db";
import { NotFoundError, deleteAllUserFiles } from "./courses";
import { classAccess, ClassError, studentInScope } from "./access";
import { audit } from "./programs";

/**
 * A student's records: export (for the student, or for staff who manage their
 * class) and deletion (the program's data about them, by the program admin; or
 * their whole account, by the site admin). Exports hold the student's own
 * answers and scores, never other students' data or question content beyond
 * the question's label.
 */

export async function studentRecords(studentId: string, opts: { classIds?: string[] } = {}) {
  const classFilter = opts.classIds ? { classId: { in: opts.classIds } } : {};
  const [user, profile, scores, answers, external, diagnostics, attendance, mistakes, guardians, memberships] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: studentId }, select: { name: true, email: true, createdAt: true, timezone: true } }),
    db.studentProfile.findUnique({ where: { userId: studentId }, select: { targetScore: true, testDate: true } }),
    db.scoreRecord.findMany({ where: { studentId }, orderBy: { takenOn: "asc" }, select: { source: true, takenOn: true, testName: true, total: true, rw: true, math: true, isBaseline: true, missed: true, verifiedAt: true } }),
    db.assignmentAnswer.findMany({ where: { userId: studentId, assignment: classFilter }, orderBy: { createdAt: "asc" }, select: { createdAt: true, correct: true, score: true, verdict: true, gradedBy: true, assignment: { select: { title: true, class: { select: { name: true } } } }, item: { select: { label: true, domain: true, skill: true } } } }),
    db.externalResult.findMany({ where: { userId: studentId, assignment: classFilter }, select: { itemKey: true, result: true, reason: true, createdAt: true, assignment: { select: { title: true } } } }),
    db.diagnosticAttempt.findMany({ where: { userId: studentId, assignment: classFilter }, select: { attemptNo: true, startedAt: true, finishedAt: true, results: true, assignment: { select: { title: true } } } }),
    db.attendanceRecord.findMany({ where: { studentId, session: classFilter }, select: { status: true, session: { select: { startsAt: true, title: true, class: { select: { name: true } } } } } }),
    db.mistakeItem.findMany({ where: { studentId }, select: { label: true, domain: true, skill: true, reason: true, streak: true, retiredAt: true, createdAt: true } }),
    db.guardianContact.findMany({ where: { studentId }, select: { name: true, email: true, relationship: true, consentAt: true, unsubscribedAt: true } }),
    db.classMember.findMany({ where: { userId: studentId, ...classFilter }, select: { joinedAt: true, class: { select: { name: true } } } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    student: user,
    goals: profile,
    classes: memberships.map((m) => ({ class: m.class.name, joined: m.joinedAt })),
    scores,
    assignmentAnswers: answers.map((a) => ({ at: a.createdAt, assignment: a.assignment.title, class: a.assignment.class.name, question: a.item.label, domain: a.item.domain, skill: a.item.skill, correct: a.correct, score: a.score, gradedBy: a.gradedBy })),
    collegeBoardResults: external.map((e) => ({ at: e.createdAt, assignment: e.assignment.title, result: e.result, reason: e.reason })),
    diagnostics: diagnostics.map((d) => ({ diagnostic: d.assignment.title, attempt: d.attemptNo, started: d.startedAt, finished: d.finishedAt, results: d.results })),
    attendance: attendance.map((a) => ({ class: a.session.class.name, session: a.session.startsAt, title: a.session.title, status: a.status })),
    mistakeLog: mistakes,
    guardians,
  };
}

/** Staff export of one student in a class they manage (teacher or program admin). */
export async function exportStudentForStaff(actorId: string, classId: string, studentId: string) {
  const access = await classAccess(actorId, classId, "manageClass");
  if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  const classIds = (await db.class.findMany({ where: { programId: access.programId }, select: { id: true } })).map((c) => c.id);
  const data = await studentRecords(studentId, { classIds });
  await audit(db, { programId: access.programId, actorId, action: "student.export", targetType: "user", targetId: studentId, summary: "Exported a student's records" });
  return data;
}

/**
 * The program admin removes everything the program holds about a student:
 * their place in its classes, answers, College Board results, diagnostics,
 * attendance, groups and alerts there. Scores, mistakes, goals and guardians
 * belong to the student and are removed too when they have no other program.
 */
export async function purgeStudentFromProgram(actorId: string, programId: string, studentId: string, confirmName: string) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: actorId }, include: { classes: { select: { id: true } } } });
  if (!p) throw new NotFoundError("Program not found");
  const classIds = p.classes.map((c) => c.id);
  const student = await db.user.findUnique({ where: { id: studentId }, select: { name: true, classMemberships: { select: { classId: true } } } });
  if (!student || !student.classMemberships.some((m) => classIds.includes(m.classId))) throw new NotFoundError("Student not found");
  if (confirmName.trim() !== student.name.trim()) throw new ClassError("Type the student's name exactly to confirm.");
  const elsewhere = student.classMemberships.some((m) => !classIds.includes(m.classId));
  await db.$transaction(async (tx) => {
    const inProgram = { classId: { in: classIds } };
    await tx.assignmentAnswer.deleteMany({ where: { userId: studentId, assignment: inProgram } });
    await tx.assignmentStart.deleteMany({ where: { userId: studentId, assignment: inProgram } });
    await tx.externalResult.deleteMany({ where: { userId: studentId, assignment: inProgram } });
    await tx.diagnosticAttempt.deleteMany({ where: { userId: studentId, assignment: inProgram } });
    await tx.diagnosticRetake.deleteMany({ where: { userId: studentId, assignment: inProgram } });
    await tx.attendanceRecord.deleteMany({ where: { studentId, session: inProgram } });
    await tx.alertState.deleteMany({ where: { studentId, ...inProgram } });
    await tx.classGroupMember.deleteMany({ where: { userId: studentId, group: inProgram } });
    await tx.classMember.deleteMany({ where: { userId: studentId, ...inProgram } });
    if (!elsewhere) {
      await tx.scoreRecord.deleteMany({ where: { studentId } });
      await tx.mistakeItem.deleteMany({ where: { studentId } });
      await tx.studentProfile.deleteMany({ where: { userId: studentId } });
      await tx.guardianContact.deleteMany({ where: { studentId } });
    }
    await audit(tx, { programId, actorId, action: "student.purge", targetType: "user", targetId: studentId, summary: `Deleted the program's data about a student${elsewhere ? " (they're in another program, so their own scores stay)" : ""}` });
  });
}

/** The site admin deletes a whole account and every file (as the person could themselves from Settings). */
export async function deleteAccountCompletely(siteAdminId: string, email: string, confirmEmail: string) {
  const admin = await db.user.findUnique({ where: { id: siteAdminId }, select: { role: true } });
  if (admin?.role !== "ADMIN") throw new ClassError("Only the site admin can do that.", 403);
  if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) throw new ClassError("Type the email address twice to confirm.");
  const u = await db.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true, role: true } });
  if (!u) throw new NotFoundError("No account has that email.");
  if (u.id === siteAdminId) throw new ClassError("Delete your own account from Settings.");
  const shared = await db.program.count({ where: { adminId: u.id, classes: { some: { OR: [{ staff: { some: { userId: { not: u.id } } } }, { members: { some: {} } }] } } } });
  if (shared) throw new ClassError("They're the admin of a program with other people. Transfer the admin role first.");
  await deleteAllUserFiles(u.id);
  await db.user.delete({ where: { id: u.id } });
}
