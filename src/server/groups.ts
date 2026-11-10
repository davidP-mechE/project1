import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { classAccess, ClassError } from "./access";
import { audit } from "./programs";

/**
 * Groups within a class (a score band, a weak subject, a session time). They
 * are also how a specialist (e.g. a student tutor) is limited to some students.
 * Only teachers and the program admin create or change them; specialists see
 * the groups they're scoped to.
 */

const MAX_GROUPS = 40;

export async function listGroups(userId: string, classId: string) {
  const access = await classAccess(userId, classId);
  const groups = await db.classGroup.findMany({
    where: { classId, ...(access.groupIds.length ? { id: { in: access.groupIds } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, members: { select: { user: { select: { id: true, name: true } } } } },
  });
  const students = await db.classMember.findMany({ where: { classId }, orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true } } } });
  const manage = access.role === "ADMIN" || access.role === "TEACHER";
  return {
    access,
    manage,
    groups: groups.map((g) => ({ id: g.id, name: g.name, members: g.members.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name)) })),
    // The full student list is only needed (and only shown) to people who can change groups.
    students: manage ? students.map((s) => s.user) : [],
  };
}

export async function createGroup(userId: string, classId: string, name: string, studentIds: string[] = []) {
  const access = await classAccess(userId, classId, "manageClass");
  const n = name.trim().slice(0, 80);
  if (!n) throw new ClassError("Give the group a name.");
  if ((await db.classGroup.count({ where: { classId } })) >= MAX_GROUPS) throw new ClassError(`A class can have up to ${MAX_GROUPS} groups.`);
  const members = await validMembers(classId, studentIds);
  return db.$transaction(async (tx) => {
    const g = await tx.classGroup.create({ data: { classId, name: n, members: { create: members.map((userId) => ({ userId })) } } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "group.create", targetType: "group", targetId: g.id, summary: `Created group "${n}" in ${access.className} (${members.length} students)` });
    return g;
  });
}

async function validMembers(classId: string, studentIds: string[]) {
  const wanted = [...new Set(studentIds)];
  if (!wanted.length) return [];
  const found = await db.classMember.findMany({ where: { classId, userId: { in: wanted } }, select: { userId: true } });
  if (found.length !== wanted.length) throw new ClassError("Some of those students aren't in this class.");
  return found.map((f) => f.userId);
}

async function groupIn(classId: string, groupId: string) {
  const g = await db.classGroup.findFirst({ where: { id: groupId, classId } });
  if (!g) throw new NotFoundError("Group not found");
  return g;
}

/** Rename a group and/or set exactly who's in it. Changing members changes what scoped specialists see. */
export async function updateGroup(userId: string, classId: string, groupId: string, patch: { name?: string; studentIds?: string[] }) {
  const access = await classAccess(userId, classId, "manageClass");
  const g = await groupIn(classId, groupId);
  const name = patch.name === undefined ? g.name : patch.name.trim().slice(0, 80);
  if (!name) throw new ClassError("Give the group a name.");
  const members = patch.studentIds ? await validMembers(classId, patch.studentIds) : null;
  await db.$transaction(async (tx) => {
    await tx.classGroup.update({ where: { id: g.id }, data: { name } });
    if (members) {
      await tx.classGroupMember.deleteMany({ where: { groupId: g.id, userId: { notIn: members } } });
      await tx.classGroupMember.createMany({ data: members.map((u) => ({ groupId: g.id, userId: u })), skipDuplicates: true });
    }
    await audit(tx, { programId: access.programId, actorId: userId, action: "group.update", targetType: "group", targetId: g.id, summary: `Updated group "${name}" in ${access.className}${members ? ` (${members.length} students)` : ""}` });
  });
}

export async function deleteGroup(userId: string, classId: string, groupId: string) {
  const access = await classAccess(userId, classId, "manageClass");
  const g = await groupIn(classId, groupId);
  await db.$transaction(async (tx) => {
    await tx.classGroup.delete({ where: { id: g.id } });
    // Specialists scoped only to this group now see no students until they're given another.
    await audit(tx, { programId: access.programId, actorId: userId, action: "group.delete", targetType: "group", targetId: g.id, summary: `Deleted group "${g.name}" in ${access.className}` });
  });
}
