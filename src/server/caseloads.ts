import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, ClassError } from "./access";
import { audit } from "./programs";
import { attentionList, forgetAttentionCounts } from "./attention";
import { notify } from "./notifications";
import { parseCsv } from "@/lib/csv";

/**
 * Caseloads: each student's primary tutor in a program. Only the program admin
 * assigns them (one by one, a whole class or group at once, or from a CSV).
 * A tutor must teach the student: be a teacher or specialist (not a viewer) on
 * a class the student is in, and, for a group-limited specialist, have the
 * student in one of their groups. That keeps caseloads inside staff scope.
 */

async function adminOf(userId: string, programId: string) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: userId }, select: { id: true, name: true, adminId: true } });
  if (!p) throw new NotFoundError("Program not found");
  await assertStaffTwoFactor(userId);
  return p;
}

/** Students of the program (members of its live classes). */
async function programStudents(programId: string) {
  const rows = await db.classMember.findMany({ where: { class: { programId, archivedAt: null } }, distinct: ["userId"], orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true, email: true } } } });
  return rows.map((r) => r.user);
}

/** Can this person be the student's primary tutor? (They must teach the student in one of the program's classes.) */
export async function canTutor(programId: string, tutorId: string, studentId: string) {
  const p = await db.program.findUnique({ where: { id: programId }, select: { adminId: true } });
  const memberships = await db.classMember.findMany({ where: { userId: studentId, class: { programId, archivedAt: null } }, select: { classId: true } });
  if (!memberships.length) return false;
  if (p?.adminId === tutorId) return true;
  const groups = new Set((await db.classGroupMember.findMany({ where: { userId: studentId }, select: { groupId: true } })).map((g) => g.groupId));
  const staff = await db.classStaff.findMany({ where: { userId: tutorId, classId: { in: memberships.map((m) => m.classId) }, role: { in: ["TEACHER", "SPECIALIST"] } }, select: { role: true, groupIds: true } });
  return staff.some((s) => s.role === "TEACHER" || !s.groupIds.length || s.groupIds.some((g) => groups.has(g)));
}

/** Staff who can hold a caseload: the admin, and teachers and specialists on the program's live classes. */
export async function tutorOptions(programId: string) {
  const p = await db.program.findUniqueOrThrow({ where: { id: programId }, select: { admin: { select: { id: true, name: true } } } });
  const staff = await db.classStaff.findMany({ where: { class: { programId, archivedAt: null }, role: { in: ["TEACHER", "SPECIALIST"] } }, distinct: ["userId"], select: { user: { select: { id: true, name: true } } } });
  const all = new Map([[p.admin.id, p.admin.name], ...staff.map((s) => [s.user.id, s.user.name] as const)]);
  return [...all.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Give students a primary tutor (or none, with tutorId null). Students the
 * tutor doesn't teach are skipped and reported. Audited; the tutor gets a notice.
 */
export async function assignTutor(adminId: string, programId: string, studentIds: string[], tutorId: string | null, now = new Date()) {
  const p = await adminOf(adminId, programId);
  const ids = [...new Set(studentIds)].slice(0, 2000);
  const inProgram = new Set((await programStudents(programId)).map((s) => s.id));
  const assigned: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    if (!inProgram.has(id)) {
      skipped.push(id);
      continue;
    }
    if (tutorId === null) {
      await db.primaryTutor.deleteMany({ where: { programId, studentId: id } });
      assigned.push(id);
      continue;
    }
    if (!(await canTutor(programId, tutorId, id))) {
      skipped.push(id);
      continue;
    }
    await db.primaryTutor.upsert({ where: { programId_studentId: { programId, studentId: id } }, create: { programId, studentId: id, tutorId, assignedById: adminId, assignedAt: now }, update: { tutorId, assignedById: adminId, assignedAt: now } });
    assigned.push(id);
  }
  if (assigned.length) {
    const tutor = tutorId ? await db.user.findUnique({ where: { id: tutorId }, select: { name: true } }) : null;
    await audit(db, { programId, actorId: adminId, action: "caseload.assign", targetType: "user", targetId: tutorId ?? "none", summary: tutorId ? `${assigned.length} student${assigned.length === 1 ? "" : "s"} assigned to ${tutor?.name ?? "a tutor"}` : `${assigned.length} student${assigned.length === 1 ? "" : "s"} taken off a caseload` });
    if (tutorId && tutorId !== adminId) {
      await notify([tutorId], { kind: "attention", key: `caseload:${programId}:${now.toISOString().slice(0, 10)}`, title: `Your caseload in ${p.name} changed`, href: "/teach/attention?mine=1" }, now);
    }
    forgetAttentionCounts();
  }
  return { assigned: assigned.length, skipped: skipped.length };
}

/** Everyone in a class, or in one of its groups, to one tutor. */
export async function assignTutorToClass(adminId: string, programId: string, input: { classId: string; groupId?: string | null; tutorId: string | null }, now = new Date()) {
  await adminOf(adminId, programId);
  const c = await db.class.findFirst({ where: { id: input.classId, programId }, select: { id: true } });
  if (!c) throw new NotFoundError("Class not found");
  if (input.groupId && !(await db.classGroup.count({ where: { id: input.groupId, classId: c.id } }))) throw new NotFoundError("Group not found");
  const members = await db.classMember.findMany({
    where: { classId: c.id, ...(input.groupId ? { user: { groupMemberships: { some: { groupId: input.groupId } } } } : {}) },
    select: { userId: true },
  });
  return assignTutor(adminId, programId, members.map((m) => m.userId), input.tutorId, now);
}

export type CaseloadCsvRow = { line: number; studentEmail: string; tutorEmail: string; ok: boolean; problem: string | null; studentId?: string; tutorId?: string };

/** Check (commit = false) or apply a CSV: student_email,tutor_email (a header row is optional). */
export async function importCaseloadCsv(adminId: string, programId: string, text: string, commit: boolean, now = new Date()) {
  await adminOf(adminId, programId);
  if (text.length > 500_000) throw new ClassError("That file is too large (500 KB at most).");
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (rows.length && /student/i.test(rows[0][0] ?? "")) rows.shift();
  if (rows.length > 2000) throw new ClassError("At most 2,000 rows at a time.");
  const students = await programStudents(programId);
  const byEmail = new Map(students.map((s) => [s.email.toLowerCase(), s.id]));
  const tutors = await tutorOptions(programId);
  const tutorUsers = await db.user.findMany({ where: { id: { in: tutors.map((t) => t.id) } }, select: { id: true, email: true } });
  const tutorByEmail = new Map(tutorUsers.map((t) => [t.email.toLowerCase(), t.id]));
  const out: CaseloadCsvRow[] = [];
  for (const [i, r] of rows.entries()) {
    const studentEmail = (r[0] ?? "").trim().toLowerCase();
    const tutorEmail = (r[1] ?? "").trim().toLowerCase();
    const row: CaseloadCsvRow = { line: i + 1, studentEmail, tutorEmail, ok: false, problem: null };
    const sid = byEmail.get(studentEmail);
    const tid = tutorByEmail.get(tutorEmail);
    if (!sid) row.problem = "No student with that email in this program's classes.";
    else if (!tid) row.problem = "No teacher or specialist with that email in this program.";
    else if (!(await canTutor(programId, tid, sid))) row.problem = "That tutor doesn't teach this student (add them to the student's class or group first).";
    else Object.assign(row, { ok: true, studentId: sid, tutorId: tid });
    out.push(row);
  }
  let assigned = 0;
  if (commit) {
    const byTutor = new Map<string, string[]>();
    for (const r of out) if (r.ok) byTutor.set(r.tutorId!, [...(byTutor.get(r.tutorId!) ?? []), r.studentId!]);
    for (const [tid, sids] of byTutor) assigned += (await assignTutor(adminId, programId, sids, tid, now)).assigned;
  }
  return { rows: out, ready: out.filter((r) => r.ok).length, problems: out.filter((r) => !r.ok).length, assigned };
}

/**
 * The caseload page: each tutor, their students, how many of those need
 * attention, and the last message between tutor and student. Plus the
 * students with no tutor yet. Program admin only.
 */
export async function caseloadView(adminId: string, programId: string, now = new Date()) {
  const p = await adminOf(adminId, programId);
  const [students, tutors, links, classes] = await Promise.all([
    programStudents(programId),
    tutorOptions(programId),
    db.primaryTutor.findMany({ where: { programId }, select: { studentId: true, tutorId: true } }),
    db.class.findMany({ where: { programId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, groups: { orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
  ]);
  const { items } = await attentionList(adminId, {}, now);
  const needs = new Map<string, number>();
  for (const i of items) if (i.programId === programId) needs.set(i.studentId, (needs.get(i.studentId) ?? 0) + 1);
  const threads = await db.messageThread.findMany({ where: { class: { programId }, messages: { some: {} } }, select: { studentId: true, staffId: true, lastMessageAt: true } });
  const lastContact = new Map<string, Date>();
  for (const t of threads) {
    const k = `${t.staffId}:${t.studentId}`;
    if (!lastContact.has(k) || lastContact.get(k)! < t.lastMessageAt) lastContact.set(k, t.lastMessageAt);
  }
  const tutorOfStudent = new Map(links.map((l) => [l.studentId, l.tutorId]));
  const row = (s: (typeof students)[number], tutorId: string | null) => ({ id: s.id, name: s.name, email: s.email, needs: needs.get(s.id) ?? 0, lastContact: tutorId ? (lastContact.get(`${tutorId}:${s.id}`) ?? null) : null });
  const loads = tutors.map((t) => {
    const mine = students.filter((s) => tutorOfStudent.get(s.id) === t.id).map((s) => row(s, t.id));
    return { tutor: t, students: mine, needing: mine.filter((s) => s.needs > 0).length };
  });
  const unassigned = students.filter((s) => !tutorOfStudent.has(s.id)).map((s) => row(s, null));
  return { program: { id: p.id, name: p.name }, loads, unassigned, tutors, classes, total: students.length };
}

/** A student's primary tutors (one per program), for the student themself or staff who can see them. */
export async function primaryTutorsOf(studentId: string) {
  return db.primaryTutor.findMany({ where: { studentId, program: { classes: { some: { archivedAt: null, members: { some: { userId: studentId } } } } } }, select: { programId: true, program: { select: { name: true } }, tutor: { select: { id: true, name: true } } } });
}
