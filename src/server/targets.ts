import "server-only";
import { db } from "./db";
import { ClassError, type ClassAccess } from "./access";

/**
 * Who an assignment is for: the whole class (no groups or students listed),
 * or some groups and/or chosen students. A student who joins a group later
 * gets that group's open assignments, because membership is checked each time.
 */

export type Targets = { groupIds: string[]; studentIds: string[] };

export const forWholeClass = (a: Targets) => a.groupIds.length === 0 && a.studentIds.length === 0;

/** Is this assignment for this student (given the groups they're in)? */
export function assignedTo(a: Targets, userId: string, groups: Set<string>) {
  return forWholeClass(a) || a.studentIds.includes(userId) || a.groupIds.some((g) => groups.has(g));
}

/** The student's groups, per class. */
export async function groupsByClass(userId: string, classIds?: string[]) {
  const rows = await db.classGroupMember.findMany({ where: { userId, ...(classIds ? { group: { classId: { in: classIds } } } : {}) }, select: { groupId: true, group: { select: { classId: true } } } });
  const out = new Map<string, Set<string>>();
  for (const r of rows) out.set(r.group.classId, new Set([...(out.get(r.group.classId) ?? []), r.groupId]));
  return out;
}

export async function isAssignedToStudent(a: Targets & { classId: string }, userId: string) {
  if (forWholeClass(a)) return true;
  const g = (await groupsByClass(userId, [a.classId])).get(a.classId) ?? new Set();
  return assignedTo(a, userId, g);
}

/** Of these students, the ones an assignment is for. */
export async function studentsTargeted(a: Targets & { classId: string }, studentIds: string[]) {
  if (forWholeClass(a)) return new Set(studentIds);
  const members = a.groupIds.length ? await db.classGroupMember.findMany({ where: { groupId: { in: a.groupIds }, group: { classId: a.classId } }, select: { userId: true } }) : [];
  const set = new Set([...a.studentIds, ...members.map((m) => m.userId)]);
  return new Set(studentIds.filter((s) => set.has(s)));
}

/**
 * Check targets chosen by a staff member: groups and students must be in the
 * class, and inside the person's own scope (a tutor limited to group B can only
 * assign to group B or its students). A group-limited person assigning to the
 * "whole class" assigns to their own groups.
 */
export async function cleanTargets(access: ClassAccess, input: Partial<Targets> | undefined): Promise<Targets> {
  const groupIds = [...new Set(input?.groupIds ?? [])];
  const studentIds = [...new Set(input?.studentIds ?? [])];
  if (groupIds.length) {
    const found = await db.classGroup.count({ where: { id: { in: groupIds }, classId: access.classId } });
    if (found !== groupIds.length) throw new ClassError("Some of those groups aren't in this class.");
    if (access.groupIds.length && groupIds.some((g) => !access.groupIds.includes(g))) throw new ClassError("You can only assign to your own groups.", 403);
  }
  if (studentIds.length) {
    const where = access.groupIds.length ? { classId: access.classId, userId: { in: studentIds }, user: { groupMemberships: { some: { groupId: { in: access.groupIds } } } } } : { classId: access.classId, userId: { in: studentIds } };
    const found = await db.classMember.count({ where });
    if (found !== studentIds.length) throw new ClassError(access.groupIds.length ? "You can only assign to students in your groups." : "Some of those students aren't in this class.", access.groupIds.length ? 403 : 400);
  }
  if (!groupIds.length && !studentIds.length && access.groupIds.length) return { groupIds: [...access.groupIds], studentIds: [] };
  return { groupIds, studentIds };
}
