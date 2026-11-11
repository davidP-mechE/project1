import "server-only";
import { db } from "./db";
import { can, classAccess, ClassError } from "./access";
import { audit } from "./programs";
import { classProgress, inviteStudents } from "./classes";
import { parseCsv, toCsv } from "@/lib/csv";

/**
 * Roster import (CSV: name, email, group, target, baseline, baseline_date) and
 * grade export. An import is previewed row by row first, and nothing is sent
 * if any row has an error. Imported students are invited by email; their
 * group, goal and baseline are applied when they join.
 */

export type RosterRow = { line: number; name: string; email: string; group: string; target: number | null; baseline: number | null; baselineOn: string | null; errors: string[] };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 300;

export function readRoster(text: string): { rows: RosterRow[]; error: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: "The file needs a header row (name, email, …) and at least one student." };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (n: string) => header.indexOf(n);
  if (col("email") === -1) return { rows: [], error: "The file needs an \"email\" column." };
  if (table.length - 1 > MAX_ROWS) return { rows: [], error: `Up to ${MAX_ROWS} students at a time.` };
  const seen = new Set<string>();
  const rows = table.slice(1).map((r, i) => {
    const get = (n: string) => (col(n) === -1 ? "" : (r[col(n)] ?? "").trim());
    const email = get("email").toLowerCase();
    const errors: string[] = [];
    if (!EMAIL.test(email) || email.length > 254) errors.push("email isn't valid");
    if (seen.has(email)) errors.push("email is listed twice");
    seen.add(email);
    const num = (v: string, lo: number, hi: number, what: string) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi || n % 10) {
        errors.push(`${what} must be ${lo}–${hi} in steps of 10`);
        return null;
      }
      return n;
    };
    const target = num(get("target"), 400, 1600, "target");
    const baseline = num(get("baseline"), 400, 1600, "baseline");
    const baselineOn = get("baseline_date") || null;
    if (baselineOn && (!/^\d{4}-\d{2}-\d{2}$/.test(baselineOn) || Number.isNaN(new Date(baselineOn).getTime()))) errors.push("baseline_date must look like 2026-09-14");
    if (baselineOn && !baseline) errors.push("baseline_date without a baseline");
    return { line: i + 2, name: get("name").slice(0, 120), email, group: get("group").slice(0, 80), target, baseline, baselineOn, errors };
  });
  return { rows, error: null };
}

export async function previewRoster(userId: string, classId: string, text: string) {
  await classAccess(userId, classId, "manageClass");
  const { rows, error } = readRoster(text);
  if (error) throw new ClassError(error);
  const members = new Set((await db.classMember.findMany({ where: { classId, user: { email: { in: rows.map((r) => r.email) } } }, select: { user: { select: { email: true } } } })).map((m) => m.user.email.toLowerCase()));
  return rows.map((r) => ({ ...r, alreadyIn: members.has(r.email) }));
}

/** Invite everyone in the file (if every row is valid), and remember their group, goal and baseline for when they join. */
export async function importRoster(userId: string, classId: string, text: string) {
  const access = await classAccess(userId, classId, "manageClass");
  const { rows, error } = readRoster(text);
  if (error) throw new ClassError(error);
  const bad = rows.filter((r) => r.errors.length);
  if (bad.length) throw new ClassError(`Fix ${bad.length} ${bad.length === 1 ? "row" : "rows"} first (e.g. line ${bad[0].line}: ${bad[0].errors[0]}). Nothing was sent.`);
  const result = await inviteStudents(userId, classId, rows.map((r) => r.email).join(","));
  for (const r of rows.filter((x) => result.invited.includes(x.email))) {
    await db.classInvite.updateMany({ where: { classId, email: r.email }, data: { name: r.name || null, groupName: r.group || null, targetScore: r.target, baselineTotal: r.baseline, baselineOn: r.baselineOn ? new Date(`${r.baselineOn}T12:00:00Z`) : null } });
  }
  await audit(db, { programId: access.programId, actorId: userId, action: "roster.import", targetType: "class", targetId: classId, summary: `Imported a roster: ${result.invited.length} invited, ${result.alreadyIn.length} already in the class` });
  return { invited: result.invited.length, alreadyIn: result.alreadyIn.length };
}

/** When an invited student joins: their group, goal and baseline from the roster. */
export async function applyRosterDetails(classId: string, userId: string, email: string) {
  const inv = await db.classInvite.findUnique({ where: { classId_email: { classId, email: email.toLowerCase() } } });
  if (!inv) return;
  if (inv.groupName) {
    const c = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { groups: { where: { name: inv.groupName }, select: { id: true } } } });
    const groupId = c.groups[0]?.id ?? (await db.classGroup.create({ data: { classId, name: inv.groupName } })).id;
    await db.classGroupMember.createMany({ data: [{ groupId, userId }], skipDuplicates: true });
  }
  if (inv.targetScore) await db.studentProfile.upsert({ where: { userId }, create: { userId, targetScore: inv.targetScore }, update: { targetScore: inv.targetScore } });
  if (inv.baselineTotal && !(await db.scoreRecord.count({ where: { studentId: userId } }))) {
    const c = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { teacherId: true } });
    await db.scoreRecord.create({ data: { studentId: userId, source: "PRACTICE_OTHER", testName: "From the class roster", takenOn: inv.baselineOn ?? inv.createdAt, total: inv.baselineTotal, isBaseline: true, enteredById: c.teacherId, verifiedById: c.teacherId, verifiedAt: new Date() } });
  }
}

/**
 * Grades as CSV: students × assignments (score, or lessons done), then their
 * baseline and latest SAT score. Only students in the caller's scope. Email
 * addresses only when asked for, and only for those who manage the class.
 */
export async function exportGrades(userId: string, classId: string, opts: { contacts?: boolean } = {}) {
  const access = await classAccess(userId, classId);
  if (!can(access, "export")) throw new ClassError("Viewers can't export student data.", 403);
  const contacts = Boolean(opts.contacts) && (access.role === "ADMIN" || access.role === "TEACHER");
  const grid = await classProgress(userId, classId);
  const scores = await db.scoreRecord.findMany({ where: { studentId: { in: grid.students.map((s) => s.id) } }, orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }], select: { studentId: true, total: true, isBaseline: true } });
  const header = ["Student", ...(contacts ? ["Email"] : []), ...grid.assignments.map((a) => a.title), "Baseline", "Latest SAT score"];
  const rows = grid.students.map((s) => {
    const rs = scores.filter((r) => r.studentId === s.id);
    const cells = grid.assignments.map((a) => {
      const c = grid.cells[`${s.id}:${a.id}`];
      if (!c || c.status === "not_assigned") return "n/a";
      if (c.score !== null) return `${Math.round(c.score * 100)}%`;
      return c.status === "done" ? "Done" : c.total ? `${c.done}/${c.total}` : c.status === "in_progress" ? "Started" : "";
    });
    return [s.name, ...(contacts ? [s.email] : []), ...cells, (rs.find((r) => r.isBaseline) ?? rs[0])?.total ?? "", rs.at(-1)?.total ?? ""];
  });
  await audit(db, { programId: access.programId, actorId: userId, action: "grades.export", targetType: "class", targetId: classId, summary: `Exported grades for ${access.className}${contacts ? " (with emails)" : ""}` });
  return { filename: `${access.className.replace(/[^\w-]+/g, "-").slice(0, 60)}-grades.csv`, csv: toCsv([header, ...rows]) };
}
