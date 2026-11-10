import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { can, classAccess, ClassError, memberWhere, studentInScope, type ClassAccess } from "./access";
import { audit } from "./programs";
import { classProgress } from "./classes";
import { stalling } from "@/lib/sat/scores";

/**
 * Running a cohort: tutoring sessions and attendance, alerts (missing work,
 * dropping scores, inactive students, repeated absences), and guardians who
 * agreed to a weekly email.
 */

const STATUSES = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;
export type AttendanceStatus = (typeof STATUSES)[number];

// ─── Sessions and attendance ─────────────────────────────────────────────

/** Sessions this person can see: all for teachers; a group-limited specialist sees class-wide sessions and their groups'. */
function sessionWhere(a: ClassAccess) {
  return a.groupIds.length ? { classId: a.classId, OR: [{ groupId: null }, { groupId: { in: a.groupIds } }] } : { classId: a.classId };
}

const PAST_PAGE = 30;

/** Upcoming sessions (the next 10) and past ones, newest first, 30 a page (`before`: the last id shown). */
export async function listSessions(userId: string, classId: string, opts: { before?: string } = {}, now = new Date()) {
  const access = await classAccess(userId, classId);
  const include = { _count: { select: { attendance: true } } } as const;
  const [upcoming, pastRows, groups] = await Promise.all([
    db.classSession.findMany({ where: { ...sessionWhere(access), endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 10, include }),
    db.classSession.findMany({ where: { ...sessionWhere(access), endsAt: { lt: now } }, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: PAST_PAGE + 1, ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}), include }),
    db.classGroup.findMany({ where: { classId }, select: { id: true, name: true } }),
  ]);
  const past = pastRows.slice(0, PAST_PAGE);
  return { access, upcoming, past, sessions: [...upcoming, ...past], olderCursor: pastRows.length > PAST_PAGE ? past.at(-1)!.id : null, groups, canMark: can(access, "grade") };
}

/** One session, or a weekly series of up to 20. */
export async function createSessions(userId: string, classId: string, input: { startsAt: string; minutes: number; weeks?: number; groupId?: string | null; title?: string }) {
  const access = await classAccess(userId, classId, "teach");
  const start = new Date(input.startsAt);
  if (Number.isNaN(start.getTime())) throw new ClassError("Choose a date and time.");
  if (!Number.isInteger(input.minutes) || input.minutes < 10 || input.minutes > 480) throw new ClassError("A session is 10 minutes to 8 hours.");
  const weeks = input.weeks ?? 1;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 20) throw new ClassError("Repeat for 1 to 20 weeks.");
  if (input.groupId) {
    if (!(await db.classGroup.count({ where: { id: input.groupId, classId } }))) throw new ClassError("That group isn't in this class.");
    if (access.groupIds.length && !access.groupIds.includes(input.groupId)) throw new ClassError("You can only add sessions for your own groups.", 403);
  } else if (access.groupIds.length) {
    throw new ClassError("Choose one of your groups for the session.", 403);
  }
  const rows = Array.from({ length: weeks }, (_, w) => {
    const s = new Date(start.getTime() + w * 7 * 86_400_000);
    return { classId, groupId: input.groupId || null, title: input.title?.trim().slice(0, 120) || null, startsAt: s, endsAt: new Date(s.getTime() + input.minutes * 60_000), createdById: userId };
  });
  await db.classSession.createMany({ data: rows });
  return rows.length;
}

export async function deleteSession(userId: string, classId: string, sessionId: string) {
  const access = await classAccess(userId, classId, "teach");
  const s = await db.classSession.findFirst({ where: { id: sessionId, ...sessionWhere(access) } });
  if (!s) throw new NotFoundError("Session not found");
  await db.classSession.delete({ where: { id: s.id } });
}

/** A session's register: the students it's for (in the caller's scope) and their marks. */
export async function sessionRegister(userId: string, classId: string, sessionId: string) {
  const access = await classAccess(userId, classId);
  const s = await db.classSession.findFirst({ where: { id: sessionId, ...sessionWhere(access) }, include: { attendance: true } });
  if (!s) throw new NotFoundError("Session not found");
  const members = await db.classMember.findMany({
    where: { ...memberWhere(access), ...(s.groupId ? { user: { groupMemberships: { some: { groupId: s.groupId } } } } : {}) },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });
  const mark = new Map(s.attendance.map((r) => [r.studentId, r.status]));
  return { access, session: s, canMark: can(access, "grade"), students: members.map((m) => ({ ...m.user, status: (mark.get(m.user.id) ?? null) as AttendanceStatus | null })) };
}

/** Mark attendance (teachers, the admin, and specialists for their students). Changing an existing mark is audited. */
export async function markAttendance(userId: string, classId: string, sessionId: string, studentId: string, status: string, now = new Date()) {
  if (!(STATUSES as readonly string[]).includes(status)) throw new ClassError("Choose present, late, absent or excused.");
  const access = await classAccess(userId, classId, "grade");
  const s = await db.classSession.findFirst({ where: { id: sessionId, ...sessionWhere(access) } });
  if (!s) throw new NotFoundError("Session not found");
  if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  const before = await db.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId, studentId } } });
  await db.$transaction(async (tx) => {
    await tx.attendanceRecord.upsert({ where: { sessionId_studentId: { sessionId, studentId } }, create: { sessionId, studentId, status, markedById: userId, markedAt: now }, update: { status, markedById: userId, markedAt: now } });
    if (before && before.status !== status) {
      await audit(tx, { programId: access.programId, actorId: userId, action: "attendance.edit", targetType: "session", targetId: sessionId, summary: `Changed a student's attendance from ${before.status.toLowerCase()} to ${status.toLowerCase()}`, before: { status: before.status }, after: { status } });
    }
  });
}

/**
 * Attendance against score gains, per student in scope: sessions held for them
 * (past ones), how many they came to (present or late), and their gain since
 * the baseline. Shown with a note that it isn't cause and effect.
 */
export async function attendanceVsGains(userId: string, classId: string, now = new Date()) {
  const access = await classAccess(userId, classId);
  const members = await db.classMember.findMany({ where: memberWhere(access), orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true, groupMemberships: { where: { group: { classId } }, select: { groupId: true } } } } } });
  const sessions = await db.classSession.findMany({ where: { classId, startsAt: { lte: now } }, select: { id: true, groupId: true, attendance: { select: { studentId: true, status: true } } } });
  const scores = await db.scoreRecord.findMany({ where: { studentId: { in: members.map((m) => m.user.id) } }, orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }], select: { studentId: true, total: true, isBaseline: true } });
  return members.map(({ user }) => {
    const groups = new Set(user.groupMemberships.map((g) => g.groupId));
    const mine = sessions.filter((s) => !s.groupId || groups.has(s.groupId));
    const came = mine.filter((s) => s.attendance.some((r) => r.studentId === user.id && (r.status === "PRESENT" || r.status === "LATE"))).length;
    const marked = mine.filter((s) => s.attendance.some((r) => r.studentId === user.id && r.status !== "EXCUSED")).length;
    const rs = scores.filter((r) => r.studentId === user.id);
    const base = rs.find((r) => r.isBaseline) ?? rs[0];
    const latest = rs.at(-1);
    return { id: user.id, name: user.name, sessions: mine.length, attended: came, rate: marked ? came / marked : null, gain: base && latest && latest !== base ? latest.total - base.total : null };
  });
}

/** The student's own attendance in each class. */
export async function myAttendance(userId: string) {
  const rows = await db.attendanceRecord.findMany({ where: { studentId: userId }, select: { status: true, session: { select: { classId: true } } } });
  const by = new Map<string, { attended: number; marked: number }>();
  for (const r of rows) {
    const t = by.get(r.session.classId) ?? { attended: 0, marked: 0 };
    if (r.status !== "EXCUSED") t.marked += 1;
    if (r.status === "PRESENT" || r.status === "LATE") t.attended += 1;
    by.set(r.session.classId, t);
  }
  return by;
}

// ─── Alerts ──────────────────────────────────────────────────────────────

export type AlertKind = "MISSING_WORK" | "DROPPING" | "INACTIVE" | "ABSENCES";
export type Alert = { studentId: string; name: string; kind: AlertKind; detail: string };
const INACTIVE_DAYS = 7;

/** Alerts worked out from the class's data now, minus dismissed or snoozed ones. Only students in the caller's scope. */
export async function classAlerts(userId: string, classId: string, now = new Date()) {
  const access = await classAccess(userId, classId);
  const grid = await classProgress(userId, classId, now);
  const ids = grid.students.map((s) => s.id);
  const name = new Map(grid.students.map((s) => [s.id, s.name]));
  const out: Alert[] = [];
  // Missing work: past due and not done.
  for (const s of grid.students) {
    const missing = grid.assignments.filter((a) => a.dueAt && a.dueAt < now && grid.cells[`${s.id}:${a.id}`]?.status !== "done" && grid.cells[`${s.id}:${a.id}`]?.status !== "not_assigned");
    if (missing.length) out.push({ studentId: s.id, name: s.name, kind: "MISSING_WORK", detail: `${missing.length} overdue: ${missing.slice(0, 3).map((a) => a.title).join(", ")}${missing.length > 3 ? "…" : ""}` });
  }
  // Dropping scores.
  const scores = await db.scoreRecord.findMany({ where: { studentId: { in: ids } }, orderBy: { takenOn: "asc" }, select: { studentId: true, total: true, takenOn: true, source: true } });
  for (const id of ids) {
    const st = stalling(scores.filter((r) => r.studentId === id));
    if (st.stalled) out.push({ studentId: id, name: name.get(id)!, kind: "DROPPING", detail: st.reason! });
  }
  // Inactive: no answers, attendance or login for a week.
  const since = new Date(now.getTime() - INACTIVE_DAYS * 86_400_000);
  const [answers, users, present] = await Promise.all([
    db.assignmentAnswer.groupBy({ by: ["userId"], where: { userId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, lastLoginAt: true } }),
    db.attendanceRecord.findMany({ where: { studentId: { in: ids }, status: { in: ["PRESENT", "LATE"] }, session: { startsAt: { gte: since } } }, select: { studentId: true } }),
  ]);
  const active = new Set([...answers.map((a) => a.userId), ...users.filter((u) => u.lastLoginAt && u.lastLoginAt >= since).map((u) => u.id), ...present.map((p) => p.studentId)]);
  for (const id of ids) if (!active.has(id)) out.push({ studentId: id, name: name.get(id)!, kind: "INACTIVE", detail: `No activity in ${INACTIVE_DAYS} days` });
  // Absences: the last two sessions they were marked for were absences.
  const marks = await db.attendanceRecord.findMany({ where: { studentId: { in: ids }, session: { classId, startsAt: { lte: now } } }, orderBy: { session: { startsAt: "desc" } }, select: { studentId: true, status: true } });
  for (const id of ids) {
    const last = marks.filter((m) => m.studentId === id && m.status !== "EXCUSED").slice(0, 2);
    if (last.length === 2 && last.every((m) => m.status === "ABSENT")) out.push({ studentId: id, name: name.get(id)!, kind: "ABSENCES", detail: "Absent from the last 2 sessions" });
  }
  const states = await db.alertState.findMany({ where: { classId, studentId: { in: ids } } });
  const hidden = (a: Alert) => states.some((s) => s.studentId === a.studentId && s.kind === a.kind && (s.until === null || s.until > now));
  return { access, alerts: out.filter((a) => !hidden(a)), hiddenCount: out.filter(hidden).length };
}

/** Dismiss an alert (until it clears and comes back) or snooze it for some days. */
export async function dismissAlert(userId: string, classId: string, studentId: string, kind: AlertKind, snoozeDays: number | null, now = new Date()) {
  const access = await classAccess(userId, classId, "grade");
  if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  if (!["MISSING_WORK", "DROPPING", "INACTIVE", "ABSENCES"].includes(kind)) throw new ClassError("Unknown alert.");
  const until = snoozeDays ? new Date(now.getTime() + Math.min(30, Math.max(1, snoozeDays)) * 86_400_000) : null;
  await db.alertState.upsert({ where: { classId_studentId_kind: { classId, studentId, kind } }, create: { classId, studentId, kind, dismissedById: userId, until }, update: { dismissedById: userId, until, createdAt: now } });
}

// ─── Guardians ───────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Teachers record a guardian contact, with consent (required: nothing is sent without it). */
export async function addGuardian(userId: string, classId: string, studentId: string, input: { name: string; email: string; relationship?: string; consent: boolean }, now = new Date()) {
  const access = await classAccess(userId, classId, "manageClass");
  if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  if (!input.consent) throw new ClassError("Record that the family agreed to these emails first.");
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new ClassError("Enter a valid email address.");
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new ClassError("Enter the guardian's name.");
  if ((await db.guardianContact.count({ where: { studentId } })) >= 4) throw new ClassError("Up to 4 guardians per student.");
  await db.$transaction(async (tx) => {
    const g = await tx.guardianContact.upsert({
      where: { studentId_email: { studentId, email } },
      create: { studentId, email, name, relationship: input.relationship?.trim().slice(0, 40) ?? "", consentAt: now, consentById: userId, unsubToken: randomBytes(24).toString("base64url") },
      update: { name, relationship: input.relationship?.trim().slice(0, 40) ?? "", consentAt: now, consentById: userId, unsubscribedAt: null },
    });
    await audit(tx, { programId: access.programId, actorId: userId, action: "guardian.add", targetType: "guardian", targetId: g.id, summary: "Added a guardian contact with recorded consent" });
  });
}

export async function removeGuardian(userId: string, classId: string, guardianId: string) {
  const access = await classAccess(userId, classId, "manageClass");
  const g = await db.guardianContact.findUnique({ where: { id: guardianId } });
  if (!g || !(await studentInScope(access, g.studentId))) throw new NotFoundError("Guardian not found");
  await db.$transaction(async (tx) => {
    await tx.guardianContact.delete({ where: { id: g.id } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "guardian.remove", targetType: "guardian", targetId: g.id, summary: "Removed a guardian contact" });
  });
}

/** Guardians for one student: staff who manage the class see them; the student sees their own. */
export async function guardiansOf(viewerId: string, studentId: string, classId?: string) {
  if (viewerId !== studentId) {
    if (!classId) throw new NotFoundError("Student not found");
    const access = await classAccess(viewerId, classId, "manageClass");
    if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  }
  return db.guardianContact.findMany({ where: { studentId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, relationship: true, consentAt: true, unsubscribedAt: true } });
}

/** One-click unsubscribe from the link in the email. */
export async function unsubscribeGuardian(token: string, now = new Date()) {
  const g = await db.guardianContact.findUnique({ where: { unsubToken: token } });
  if (!g) return false;
  if (!g.unsubscribedAt) await db.guardianContact.update({ where: { id: g.id }, data: { unsubscribedAt: now } });
  return true;
}

export async function setGuardianSummaries(userId: string, classId: string, on: boolean) {
  const access = await classAccess(userId, classId, "manageClass");
  await db.$transaction(async (tx) => {
    await tx.class.update({ where: { id: classId }, data: { guardianSummaries: on } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "class.guardian-summaries", targetType: "class", targetId: classId, summary: `Weekly guardian emails turned ${on ? "on" : "off"} for ${access.className}` });
  });
}
