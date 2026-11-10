import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, can, classAccess, ClassError, memberWhere, type ClassAccess } from "./access";
import { audit } from "./programs";
import { domainById } from "@/lib/sat/domains";
import { checkTakenOn, programStats, projectScore, ScoreInputSchema, stalling, type Missed, type ScoreInput } from "@/lib/sat/scores";

/**
 * Score tracking: a required baseline, official and practice scores (totals,
 * section scores and missed question numbers only, never content), each
 * student's history and projected range, and class and program dashboards.
 *
 * Who sees what:
 *  - a student: their own scores, and their own projection (labelled an estimate)
 *  - teachers and the program admin: every student in their classes
 *  - specialists: students in their groups; the total plus the sections in their
 *    subjects (a Math specialist doesn't see Reading and Writing scores or misses)
 *  - viewers: read-only; with fewer than 5 students in view, only aggregates
 */

const MIN_FOR_INDIVIDUALS = 5;

export type ScoreRow = {
  id: string;
  source: string;
  takenOn: Date;
  testName: string | null;
  total: number;
  rw: number | null;
  math: number | null;
  isBaseline: boolean;
  missed: Missed[];
  verified: boolean;
  enteredByStudent: boolean;
};

function parseInput(raw: unknown, now: Date): ScoreInput {
  const parsed = ScoreInputSchema.safeParse(raw);
  if (!parsed.success) throw new ClassError(parsed.error.issues[0]?.message.startsWith("Unrecognized") ? "Only scores and missed question numbers can be entered, not question content." : (parsed.error.issues[0]?.message ?? "Please check the scores."));
  const bad = checkTakenOn(parsed.data.takenOn, now);
  if (bad) throw new ClassError(bad);
  return parsed.data;
}

/** Which section scores a person may see for a student: both, or only the ones in their subjects. */
function visibleSections(a: ClassAccess | null) {
  if (!a?.subjects) return { MATH: true, RW: true };
  const d = [...a.subjects].map((x) => domainById(x)?.section);
  return { MATH: d.includes("MATH"), RW: d.includes("RW") };
}

function shape(r: { id: string; source: string; takenOn: Date; testName: string | null; total: number; rw: number | null; math: number | null; isBaseline: boolean; missed: Prisma.JsonValue; verifiedById: string | null; enteredById: string; studentId: string }, sections = { MATH: true, RW: true }): ScoreRow {
  const missed = (Array.isArray(r.missed) ? (r.missed as Missed[]) : []).filter((m) => sections[m.section]);
  return {
    id: r.id,
    source: r.source,
    takenOn: r.takenOn,
    testName: r.testName,
    total: r.total,
    rw: sections.RW ? r.rw : null,
    math: sections.MATH ? r.math : null,
    isBaseline: r.isBaseline,
    missed,
    verified: Boolean(r.verifiedById),
    enteredByStudent: r.enteredById === r.studentId,
  };
}

/** Staff access to one student in a class: "not found" unless the student is in their scope. */
async function staffForStudent(actorId: string, classId: string, studentId: string, ability: "view" | "teach" = "view") {
  const access = await classAccess(actorId, classId, ability);
  const ok = await db.classMember.count({ where: { ...memberWhere(access), userId: studentId } });
  if (!ok) throw new NotFoundError("Student not found");
  return access;
}

async function practiceSince(studentId: string, since: Date | null) {
  const rows = await db.assignmentAnswer.findMany({ where: { userId: studentId, ...(since ? { createdAt: { gt: since } } : {}) }, select: { score: true } });
  return rows.length ? { answered: rows.length, accuracy: rows.reduce((a, r) => a + r.score, 0) / rows.length } : null;
}

/** A student's history, projection and stalling flag, as one viewer may see it. */
async function history(studentId: string, sections = { MATH: true, RW: true }, now = new Date()) {
  const [rows, profile] = await Promise.all([
    db.scoreRecord.findMany({ where: { studentId }, orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }] }),
    db.studentProfile.findUnique({ where: { userId: studentId } }),
  ]);
  const points = rows.map((r) => ({ takenOn: r.takenOn, total: r.total, source: r.source }));
  const latest = rows.at(-1) ?? null;
  const projection = projectScore(points, await practiceSince(studentId, latest?.takenOn ?? null), now);
  const baseline = rows.find((r) => r.isBaseline) ?? rows[0] ?? null;
  return {
    scores: rows.map((r) => shape(r, sections)),
    baseline: baseline ? { total: baseline.total, takenOn: baseline.takenOn } : null,
    latest: latest ? { total: latest.total, takenOn: latest.takenOn } : null,
    projection,
    stall: stalling(points),
    target: profile?.targetScore ?? null,
    testDate: profile?.testDate ?? null,
    baselinePending: profile?.baselinePending ?? false,
  };
}

// ─── Students: their own scores ──────────────────────────────────────────

export async function myScores(userId: string, now = new Date()) {
  return history(userId, undefined, now);
}

/** Has the student given a baseline (or chosen to take the diagnostic)? Only asked of students in a class. */
export async function baselineStatus(userId: string) {
  const [inClass, baseline, profile] = await Promise.all([
    db.classMember.count({ where: { userId } }),
    db.scoreRecord.count({ where: { studentId: userId } }),
    db.studentProfile.findUnique({ where: { userId }, select: { baselinePending: true } }),
  ]);
  return { needed: inClass > 0 && baseline === 0, pending: Boolean(profile?.baselinePending) };
}

/** Add a score. A student adds their own; staff (teachers, specialists in scope) add one for a student, already verified. */
export async function addScore(actorId: string, studentId: string, raw: unknown, opts: { classId?: string } = {}, now = new Date()) {
  const input = parseInput(raw, now);
  let verifiedById: string | null = null;
  let programId: string | null = null;
  if (actorId !== studentId) {
    if (!opts.classId) throw new NotFoundError("Student not found");
    const access = await staffForStudent(actorId, opts.classId, studentId, "teach");
    verifiedById = actorId;
    programId = access.programId;
    // A subject-limited specialist can only record misses in their subjects.
    const visible = visibleSections(access);
    if ((input.missed ?? []).some((m) => !visible[m.section])) throw new ClassError("You can only record missed questions in your subjects.", 403);
  }
  const hasAny = await db.scoreRecord.count({ where: { studentId } });
  const isBaseline = input.isBaseline ?? hasAny === 0;
  const row = await db.$transaction(async (tx) => {
    if (isBaseline) await tx.scoreRecord.updateMany({ where: { studentId, isBaseline: true }, data: { isBaseline: false } });
    const created = await tx.scoreRecord.create({
      data: { studentId, source: input.source, takenOn: input.takenOn, testName: input.testName || null, total: input.total, rw: input.rw ?? null, math: input.math ?? null, isBaseline, missed: (input.missed ?? []) as Prisma.InputJsonValue, enteredById: actorId, verifiedById, verifiedAt: verifiedById ? now : null },
    });
    await tx.studentProfile.upsert({ where: { userId: studentId }, create: { userId: studentId, baselinePending: false }, update: { baselinePending: false } });
    if (programId) await audit(tx, { programId, actorId, action: "score.add", targetType: "score", targetId: created.id, summary: `Entered a ${input.source.toLowerCase().replace("_", " ")} score for a student` });
    return created;
  });
  return row.id;
}

/** A student edits or deletes their own unverified score; staff who teach the class can change or delete any in scope. */
async function editable(actorId: string, scoreId: string, classId?: string) {
  const s = await db.scoreRecord.findUnique({ where: { id: scoreId } });
  if (!s) throw new NotFoundError("Score not found");
  if (s.studentId === actorId) {
    if (s.verifiedById) throw new ClassError("Your teacher has verified this score, so ask them to change it.", 403);
    return { s, access: null };
  }
  if (!classId) throw new NotFoundError("Score not found");
  let access;
  try {
    access = await staffForStudent(actorId, classId, s.studentId, "teach");
  } catch (err) {
    if (err instanceof NotFoundError) throw new NotFoundError("Score not found");
    throw err;
  }
  return { s, access };
}

export async function updateScore(actorId: string, scoreId: string, raw: unknown, opts: { classId?: string } = {}, now = new Date()) {
  const { s, access } = await editable(actorId, scoreId, opts.classId);
  const input = parseInput(raw, now);
  await db.$transaction(async (tx) => {
    if (input.isBaseline) await tx.scoreRecord.updateMany({ where: { studentId: s.studentId, isBaseline: true, id: { not: s.id } }, data: { isBaseline: false } });
    await tx.scoreRecord.update({
      where: { id: s.id },
      data: { source: input.source, takenOn: input.takenOn, testName: input.testName || null, total: input.total, rw: input.rw ?? null, math: input.math ?? null, isBaseline: input.isBaseline ?? s.isBaseline, missed: (input.missed ?? []) as Prisma.InputJsonValue },
    });
    if (access) await audit(tx, { programId: access.programId, actorId, action: "score.edit", targetType: "score", targetId: s.id, summary: "Edited a student's score", before: { total: s.total, rw: s.rw, math: s.math }, after: { total: input.total, rw: input.rw ?? null, math: input.math ?? null } });
  });
}

export async function deleteScore(actorId: string, scoreId: string, opts: { classId?: string } = {}) {
  const { s, access } = await editable(actorId, scoreId, opts.classId);
  await db.$transaction(async (tx) => {
    await tx.scoreRecord.delete({ where: { id: s.id } });
    if (access) await audit(tx, { programId: access.programId, actorId, action: "score.delete", targetType: "score", targetId: s.id, summary: `Deleted a student's score (${s.total})` });
  });
}

/** Staff confirm a score a student entered (e.g. after seeing their score report). */
export async function verifyScore(actorId: string, classId: string, scoreId: string, now = new Date()) {
  const s = await db.scoreRecord.findUnique({ where: { id: scoreId } });
  if (!s) throw new NotFoundError("Score not found");
  const access = await staffForStudent(actorId, classId, s.studentId, "teach").catch((err) => {
    throw err instanceof NotFoundError ? new NotFoundError("Score not found") : err;
  });
  await db.$transaction(async (tx) => {
    await tx.scoreRecord.update({ where: { id: s.id }, data: { verifiedById: actorId, verifiedAt: now } });
    await audit(tx, { programId: access.programId, actorId, action: "score.verify", targetType: "score", targetId: s.id, summary: "Verified a student's score" });
  });
}

export async function setProfile(userId: string, patch: { targetScore?: number | null; testDate?: string | null; baselinePending?: boolean }, now = new Date()) {
  const data: Prisma.StudentProfileUncheckedUpdateInput = {};
  if (patch.targetScore !== undefined) {
    if (patch.targetScore !== null && (!Number.isInteger(patch.targetScore) || patch.targetScore < 400 || patch.targetScore > 1600 || patch.targetScore % 10)) throw new ClassError("A target is 400 to 1600, in steps of 10.");
    data.targetScore = patch.targetScore;
  }
  if (patch.testDate !== undefined) {
    const d = patch.testDate ? new Date(patch.testDate) : null;
    if (d && (Number.isNaN(d.getTime()) || d.getTime() < now.getTime() - 86_400_000)) throw new ClassError("Choose a test date in the future.");
    data.testDate = d;
  }
  if (patch.baselinePending !== undefined) data.baselinePending = patch.baselinePending;
  await db.studentProfile.upsert({ where: { userId }, create: { ...(data as Prisma.StudentProfileUncheckedCreateInput), userId }, update: data });
}

// ─── Staff: one student, a class, the program ────────────────────────────

export async function studentScoresForStaff(actorId: string, classId: string, studentId: string, now = new Date()) {
  const access = await staffForStudent(actorId, classId, studentId);
  const [student, h] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: studentId }, select: { id: true, name: true } }), history(studentId, visibleSections(access), now)]);
  return { access, student, ...h, canEdit: can(access, "teach") };
}

/** Per-student summary rows and the class's numbers (filters: a group). */
async function summarize(studentIds: string[], targets: number[], defaultTarget: number, now: Date) {
  const [records, profiles] = await Promise.all([
    db.scoreRecord.findMany({ where: { studentId: { in: studentIds } }, orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }] }),
    db.studentProfile.findMany({ where: { userId: { in: studentIds } } }),
  ]);
  const byStudent = new Map<string, typeof records>();
  for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  const profileOf = new Map(profiles.map((p) => [p.userId, p]));
  const rows = [];
  for (const id of studentIds) {
    const rs = byStudent.get(id) ?? [];
    const points = rs.map((r) => ({ takenOn: r.takenOn, total: r.total, source: r.source }));
    const latest = rs.at(-1) ?? null;
    const baseline = rs.find((r) => r.isBaseline) ?? rs[0] ?? null;
    const projection = projectScore(points, await practiceSince(id, latest?.takenOn ?? null), now);
    rows.push({
      id,
      baseline: baseline?.total ?? null,
      latest: latest?.total ?? null,
      latestOn: latest?.takenOn ?? null,
      projected: projection?.mid ?? null,
      projection,
      stall: stalling(points),
      target: profileOf.get(id)?.targetScore ?? defaultTarget,
      baselinePending: profileOf.get(id)?.baselinePending ?? false,
      scores: rs.length,
    });
  }
  return { rows, stats: programStats(rows, targets) };
}

/** The class's Scores tab: each student in scope, and the class's numbers. */
export async function classScores(actorId: string, classId: string, opts: { groupId?: string } = {}, now = new Date()) {
  const access = await classAccess(actorId, classId);
  const program = await db.program.findUniqueOrThrow({ where: { id: access.programId }, select: { targets: true } });
  const members = await db.classMember.findMany({
    where: { ...memberWhere(access), ...(opts.groupId ? { user: { groupMemberships: { some: { groupId: opts.groupId, group: { classId } } } } } : {}) },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });
  const { rows, stats } = await summarize(members.map((m) => m.user.id), program.targets, program.targets[0] ?? 1200, now);
  const names = new Map(members.map((m) => [m.user.id, m.user.name]));
  const individuals = access.role !== "VIEWER" || rows.length >= MIN_FOR_INDIVIDUALS;
  return { access, targets: program.targets, stats, students: individuals ? rows.map((r) => ({ ...r, name: names.get(r.id) ?? "Student" })) : null };
}

/** The program admin's dashboard: every student in every class (filter by class or teacher). */
export async function programDashboard(actorId: string, programId: string, opts: { classId?: string; teacherId?: string } = {}, now = new Date()) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: actorId }, select: { id: true, name: true, targets: true, classes: { where: { archivedAt: null }, select: { id: true, name: true, staff: { where: { role: "TEACHER" }, select: { user: { select: { id: true, name: true } } } } } } } });
  if (!p) throw new NotFoundError("Program not found");
  await assertStaffTwoFactor(actorId);
  const classes = p.classes.filter((c) => (!opts.classId || c.id === opts.classId) && (!opts.teacherId || c.staff.some((s) => s.user.id === opts.teacherId)));
  const members = await db.classMember.findMany({ where: { classId: { in: classes.map((c) => c.id) } }, distinct: ["userId"], select: { user: { select: { id: true, name: true } } } });
  const { rows, stats } = await summarize(members.map((m) => m.user.id), p.targets, p.targets[0] ?? 1200, now);
  const names = new Map(members.map((m) => [m.user.id, m.user.name]));
  // Gain trend: average gain over baseline of scores taken each month.
  const records = await db.scoreRecord.findMany({ where: { studentId: { in: rows.map((r) => r.id) } }, select: { studentId: true, total: true, takenOn: true } });
  const base = new Map(rows.filter((r) => r.baseline !== null).map((r) => [r.id, r.baseline!]));
  const months = new Map<string, number[]>();
  for (const r of records) {
    const b = base.get(r.studentId);
    if (b === undefined) continue;
    const k = r.takenOn.toISOString().slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), r.total - b]);
  }
  const trend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, g]) => ({ month, averageGain: Math.round(g.reduce((a, x) => a + x, 0) / g.length), scores: g.length }));
  const teachers = new Map(p.classes.flatMap((c) => c.staff.map((s) => [s.user.id, s.user.name] as const)));
  return {
    program: { id: p.id, name: p.name, targets: p.targets },
    classes: p.classes.map((c) => ({ id: c.id, name: c.name })),
    teachers: [...teachers.entries()].map(([id, name]) => ({ id, name })),
    stats,
    trend,
    students: rows.map((r) => ({ ...r, name: names.get(r.id) ?? "Student" })).sort((a, b) => Number(b.stall.stalled) - Number(a.stall.stalled) || (a.projected ?? 0) - (b.projected ?? 0)),
  };
}
