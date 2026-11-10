import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { allowedDomains, scopeCovers } from "@/lib/sat/domains";

/**
 * Who may do what in a class. Every teacher-side function goes through
 * classAccess() and then filters by the scope it returns, in the server
 * (never just in the page). Access is read from the database on every call,
 * so a role change or removal takes effect on the person's next request.
 *
 *   Program admin  everything in the program's classes, and staff management
 *   Teacher        everything in the class; staff management only if granted
 *   Specialist     view, assign and grade inside their scope (subjects and/or groups)
 *   Viewer         read-only reports
 *
 * Anything outside a person's scope is "not found", so ids can't be probed.
 */

export class ClassError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ClassRole = "ADMIN" | "TEACHER" | "SPECIALIST" | "VIEWER";
export type Ability = "view" | "teach" | "grade" | "manageClass" | "manageStaff" | "export";

export type ClassAccess = {
  userId: string;
  classId: string;
  programId: string;
  className: string;
  role: ClassRole;
  isProgramAdmin: boolean;
  canManageStaff: boolean;
  /** Domains this person may see; null = every subject. */
  subjects: Set<string> | null;
  /** Groups this person is limited to; empty = every student. */
  groupIds: string[];
  /** The raw scope, for labels. */
  scope: { sections: string[]; domains: string[]; groupIds: string[] };
};

const ABILITIES: Record<ClassRole, Ability[]> = {
  ADMIN: ["view", "teach", "grade", "manageClass", "manageStaff", "export"],
  TEACHER: ["view", "teach", "grade", "manageClass", "export"],
  SPECIALIST: ["view", "teach", "grade", "export"],
  VIEWER: ["view"],
};

export function can(a: ClassAccess, ability: Ability) {
  if (ability === "manageStaff" && a.role === "TEACHER") return a.canManageStaff;
  return ABILITIES[a.role].includes(ability);
}

const NO_PERMISSION: Record<Ability, string> = {
  view: "You don't have access to this class.",
  teach: "Viewers can't assign or change work.",
  grade: "Viewers can't grade.",
  manageClass: "Only the class's teachers and the program admin can change the class or its students.",
  manageStaff: "Only the program admin (or a teacher they allow) can add, change or remove staff.",
  export: "Viewers can't export student data.",
};

export function requireAbility(a: ClassAccess, ability: Ability) {
  if (!can(a, ability)) throw new ClassError(NO_PERMISSION[ability], 403);
}

/** The caller's role and scope in a class, or "not found" if they have none. */
export async function classAccess(userId: string, classId: string, ability: Ability = "view"): Promise<ClassAccess> {
  const c = await db.class.findUnique({
    where: { id: classId },
    select: { id: true, name: true, programId: true, program: { select: { adminId: true } }, staff: { where: { userId }, take: 1 } },
  });
  if (!c) throw new NotFoundError("Class not found");
  const staff = c.staff[0];
  const isProgramAdmin = c.program.adminId === userId;
  let access: ClassAccess;
  if (isProgramAdmin) {
    access = { userId, classId, programId: c.programId, className: c.name, role: "ADMIN", isProgramAdmin, canManageStaff: true, subjects: null, groupIds: [], scope: { sections: [], domains: [], groupIds: [] } };
  } else if (staff) {
    const specialist = staff.role === "SPECIALIST";
    const scope = specialist ? { sections: staff.sections, domains: staff.domains, groupIds: staff.groupIds } : { sections: [], domains: [], groupIds: [] };
    access = {
      userId,
      classId,
      programId: c.programId,
      className: c.name,
      role: staff.role,
      isProgramAdmin: false,
      canManageStaff: staff.role === "TEACHER" && staff.canManageStaff,
      subjects: allowedDomains(scope),
      groupIds: scope.groupIds,
      scope,
    };
  } else {
    throw new NotFoundError("Class not found");
  }
  requireAbility(access, ability);
  return access;
}

/** Prisma filter for class members this person may see. */
export function memberWhere(a: ClassAccess) {
  return a.groupIds.length ? { classId: a.classId, user: { groupMemberships: { some: { groupId: { in: a.groupIds }, group: { classId: a.classId } } } } } : { classId: a.classId };
}

/** Ids of the class's students this person may see. */
export async function studentIdsInScope(a: ClassAccess): Promise<string[]> {
  return (await db.classMember.findMany({ where: memberWhere(a), select: { userId: true } })).map((m) => m.userId);
}

export async function studentInScope(a: ClassAccess, studentId: string) {
  return (await db.classMember.count({ where: { ...memberWhere(a), userId: studentId } })) > 0;
}

/** Whether this person's subject scope covers an assignment. */
export const assignmentInScope = (a: ClassAccess, work: { section: string | null; domains: string[] }) => scopeCovers(a.subjects, work);

/** Whether this person's subject scope covers a single question (by its own tags). */
export const itemInScope = (a: ClassAccess, item: { section: string | null; domain: string | null }) =>
  scopeCovers(a.subjects, { section: item.section, domains: item.domain ? [item.domain] : [] });

/** An assignment and the caller's access to its class; "not found" if out of scope. */
export async function assignmentAccess(userId: string, assignmentId: string, ability: Ability = "view") {
  const row = await db.assignment.findUnique({ where: { id: assignmentId }, select: { classId: true, section: true, domains: true } });
  if (!row) throw new NotFoundError("Assignment not found");
  let access: ClassAccess;
  try {
    access = await classAccess(userId, row.classId, ability);
  } catch (err) {
    if (err instanceof NotFoundError) throw new NotFoundError("Assignment not found");
    throw err;
  }
  if (!assignmentInScope(access, row)) throw new NotFoundError("Assignment not found");
  return access;
}

/** Classes this person teaches, assists or observes (as program admin or staff). */
export async function staffClassIds(userId: string) {
  const rows = await db.class.findMany({ where: { OR: [{ program: { adminId: userId } }, { staff: { some: { userId } } }] }, select: { id: true } });
  return rows.map((r) => r.id);
}
