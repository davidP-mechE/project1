import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, can, classAccess, ClassError, studentIdsInScope, type ClassAccess } from "./access";
import { bulkMessage } from "./messages";
import { assignQuestionSet } from "./classes";
import { createGroup } from "./groups";
import { createSessions } from "./cohort";
import { setsForSkill } from "./attention";
import { domainOfSkill, skillStats } from "./skill-stats";
import { weakSkills } from "@/lib/practice/auto";

/**
 * Suggested small groups: students grouped by their weakest skill (from the
 * same skill results weekly auto practice uses), for a class or a whole
 * program. Each group shows its size and the students' average accuracy on
 * that skill, with one-click actions: message the group, assign a set for the
 * skill, or create a session for the group. Only students and subjects in the
 * viewer's scope. No AI.
 */

export type SmallGroup = {
  skillId: string;
  skill: string;
  students: { id: string; name: string; classId: string; className: string; accuracy: number | null }[];
  /** Average accuracy on the skill among students who answered questions on it. */
  accuracy: number | null;
  sets: { id: string; title: string; onSkill: number }[];
};

async function groupsFor(accesses: ClassAccess[], now: Date) {
  const students = new Map<string, { id: string; name: string; classId: string; className: string; access: ClassAccess }>();
  for (const a of accesses) {
    const ids = await studentIdsInScope(a);
    const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    for (const u of users) if (!students.has(u.id)) students.set(u.id, { ...u, classId: a.classId, className: a.className, access: a });
  }
  const stats = await skillStats([...students.keys()], now);
  const skills = new Map((await db.skill.findMany({ where: { parentId: { not: null } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  const bySkill = new Map<string, SmallGroup["students"]>();
  for (const s of students.values()) {
    const mine = (stats.get(s.id) ?? []).filter((x) => !s.access.subjects || s.access.subjects.has(domainOfSkill(x.skillId) ?? ""));
    const worst = weakSkills(mine)[0];
    if (!worst) continue;
    bySkill.set(worst.skillId, [...(bySkill.get(worst.skillId) ?? []), { id: s.id, name: s.name, classId: s.classId, className: s.className, accuracy: worst.answered ? worst.correct / worst.answered : null }]);
  }
  const out: SmallGroup[] = [];
  for (const [skillId, list] of bySkill) {
    const answered = list.filter((x) => x.accuracy !== null);
    out.push({
      skillId,
      skill: skills.get(skillId) ?? "Skill",
      students: list.sort((a, b) => a.name.localeCompare(b.name)),
      accuracy: answered.length ? answered.reduce((n, x) => n + x.accuracy!, 0) / answered.length : null,
      sets: await setsForSkill(skillId, 5),
    });
  }
  return out.sort((a, b) => b.students.length - a.students.length || (a.accuracy ?? 1) - (b.accuracy ?? 1) || a.skill.localeCompare(b.skill));
}

/** Suggested groups for one class (staff in scope). */
export async function classSmallGroups(userId: string, classId: string, now = new Date()) {
  const access = await classAccess(userId, classId);
  return { access, groups: await groupsFor([access], now), canTeach: can(access, "teach"), canManage: can(access, "manageClass") };
}

/** Suggested groups across a program's live classes (program admin). */
export async function programSmallGroups(adminId: string, programId: string, now = new Date()) {
  const p = await db.program.findFirst({ where: { id: programId, adminId }, select: { id: true, name: true, classes: { where: { archivedAt: null }, select: { id: true } } } });
  if (!p) throw new NotFoundError("Program not found");
  await assertStaffTwoFactor(adminId);
  const accesses = [];
  for (const c of p.classes) accesses.push(await classAccess(adminId, c.id));
  return { program: { id: p.id, name: p.name }, groups: await groupsFor(accesses, now) };
}

/** Group the chosen students by class (actions run class by class, each with its own scope check). */
async function byClass(userId: string, studentIds: string[], classIds: string[]) {
  const out = new Map<string, string[]>();
  for (const classId of [...new Set(classIds)]) {
    const a = await classAccess(userId, classId, "teach");
    const inScope = new Set(await studentIdsInScope(a));
    const mine = studentIds.filter((s) => inScope.has(s));
    if (mine.length) out.set(classId, mine);
  }
  if (!out.size) throw new ClassError("None of those students are in your scope.");
  return out;
}

export async function messageSmallGroup(userId: string, input: { classIds: string[]; studentIds: string[]; body: string }, now = new Date()) {
  let sent = 0;
  for (const [classId, ids] of await byClass(userId, input.studentIds, input.classIds)) sent += (await bulkMessage(userId, classId, { studentIds: ids, body: input.body }, now)).sent;
  return { sent };
}

export async function assignSmallGroup(userId: string, input: { classIds: string[]; studentIds: string[]; setId: string; dueAt: string | null }) {
  let assigned = 0;
  for (const [classId, ids] of await byClass(userId, input.studentIds, input.classIds)) {
    await assignQuestionSet(userId, classId, { setId: input.setId, dueAt: input.dueAt, targets: { studentIds: ids, groupIds: [] } });
    assigned += ids.length;
  }
  return { assigned };
}

/** A session for the group: makes a class group with these students (named after the skill), then the session. One class at a time. */
export async function sessionForSmallGroup(userId: string, input: { classId: string; studentIds: string[]; skill: string; startsAt: string; minutes: number }) {
  const access = await classAccess(userId, input.classId, "manageClass");
  const inScope = new Set(await studentIdsInScope(access));
  const ids = input.studentIds.filter((s) => inScope.has(s));
  if (!ids.length) throw new ClassError("None of those students are in this class.");
  const day = new Date(input.startsAt);
  const label = Number.isNaN(day.getTime()) ? "" : ` · ${day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  const g = await createGroup(userId, input.classId, `Small group: ${input.skill.slice(0, 50)}${label}`, ids);
  await createSessions(userId, input.classId, { startsAt: input.startsAt, minutes: input.minutes, groupId: g.id, title: `Small group: ${input.skill.slice(0, 80)}` });
  return { groupId: g.id };
}
