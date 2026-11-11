import "server-only";
import { cache } from "react";
import { db } from "./db";

/**
 * Program access rules (Admin → Program access), set by site admins per email:
 *
 * - ONLY: the person may use the named program's classes (and the class
 *   courses, assignments and messages that come with them) and nothing else:
 *   no own uploads, no Hub courses, no other programs' classes, no new
 *   programs. Their existing own courses stay untouched but can't be opened
 *   while the rule is in place.
 * - BLOCKED: the person may not join, teach in, be added to or see the named
 *   program's classes or class courses. The rest of Coursebook works as usual.
 *
 * Rules are keyed by email, so they apply from sign-up on. Site admins are
 * never limited (they could otherwise lock themselves out of Admin).
 */

export type ProgramAccess = {
  /** Programs this person is limited to; empty = not limited. */
  only: Set<string>;
  /** Programs this person may not use. */
  blocked: Set<string>;
  /** Names of the programs in `only`, for messages. */
  onlyNames: string[];
};

const NONE: ProgramAccess = { only: new Set(), blocked: new Set(), onlyNames: [] };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** This person's rules (once per request). */
export const programAccess = cache(async (userId: string): Promise<ProgramAccess> => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, role: true } });
  if (!user || user.role === "ADMIN" || user.role === "OWNER") return NONE;
  return rulesForEmail(user.email);
});

export async function rulesForEmail(email: string): Promise<ProgramAccess> {
  const rules = await db.programAccessRule.findMany({ where: { email: normalizeEmail(email) }, select: { programId: true, mode: true, program: { select: { name: true } } } });
  if (rules.length === 0) return NONE;
  const only = rules.filter((r) => r.mode === "ONLY");
  return {
    only: new Set(only.map((r) => r.programId)),
    blocked: new Set(rules.filter((r) => r.mode === "BLOCKED").map((r) => r.programId)),
    onlyNames: only.map((r) => r.program.name),
  };
}

/** May this person use this program's classes? */
export function allowsProgram(a: ProgramAccess, programId: string) {
  if (a.blocked.has(programId)) return false;
  return a.only.size === 0 || a.only.has(programId);
}

/** May this person use Coursebook outside programs (own uploads, the Hub, new programs)? */
export const allowsCoursebook = (a: ProgramAccess) => a.only.size === 0;

/** Prisma filter on a class's programId that keeps only programs this person may use (undefined = no limit). */
export function programIdFilter(a: ProgramAccess) {
  if (a.only.size === 0 && a.blocked.size === 0) return undefined;
  const allowed = a.only.size ? [...a.only].filter((id) => !a.blocked.has(id)) : null;
  return allowed ? { in: allowed } : { notIn: [...a.blocked] };
}

/**
 * Prisma filter for the courses this person may open: with ONLY, just copies of
 * their allowed programs' class courses; with BLOCKED, anything but copies of
 * the blocked programs' class courses.
 */
export function courseAccessWhere(a: ProgramAccess) {
  const ids = programIdFilter(a);
  if (!ids) return {};
  if (a.only.size) return { classCourse: { class: { programId: ids } } };
  return { OR: [{ classCourseId: null }, { classCourse: { class: { programId: ids } } }] };
}

export const ONLY_MESSAGE = (a: ProgramAccess) =>
  `Your account is set up for ${a.onlyNames.join(" and ") || "your program"} only, so this isn't available. Ask the site admin if you need it.`;
export const PROGRAM_BLOCKED_MESSAGE = "Your account can't use this program's classes. Ask the site admin if you think this is a mistake.";

/** The message to show when this program isn't allowed for this person. */
export const programDeniedMessage = (a: ProgramAccess) => (a.only.size ? ONLY_MESSAGE(a) : PROGRAM_BLOCKED_MESSAGE);

// ── Admin: managing rules ──

export type RuleInput = { email: string; programId: string; mode: "ONLY" | "BLOCKED"; note?: string | null };

export async function listAccessRules() {
  const [rules, programs] = await Promise.all([
    db.programAccessRule.findMany({ orderBy: [{ createdAt: "desc" }], select: { id: true, email: true, mode: true, note: true, createdAt: true, program: { select: { id: true, name: true } } } }),
    db.program.findMany({ where: { isDemo: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { rules, programs };
}

/** Adds or replaces the rule for this email and program. Returns a message for the admin. */
export async function setAccessRule(adminId: string, input: RuleInput): Promise<string> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessRuleError("Enter a valid email address.");
  const program = await db.program.findUnique({ where: { id: input.programId }, select: { id: true, name: true, admin: { select: { email: true } } } });
  if (!program) throw new AccessRuleError("That program doesn't exist any more.");
  if (input.mode === "BLOCKED" && normalizeEmail(program.admin.email) === email) throw new AccessRuleError(`That's the admin of ${program.name}. Hand the program to someone else before blocking them from it.`);
  const user = await db.user.findUnique({ where: { email }, select: { role: true } });
  if (user?.role === "ADMIN" || user?.role === "OWNER") throw new AccessRuleError("Site admins can't be limited.");
  const note = input.note?.trim().slice(0, 200) || null;
  await db.programAccessRule.upsert({
    where: { email_programId: { email, programId: program.id } },
    create: { email, programId: program.id, mode: input.mode, note, createdById: adminId },
    update: { mode: input.mode, note, createdById: adminId },
  });
  return input.mode === "ONLY" ? `${email} can now use only ${program.name}.` : `${email} is now blocked from ${program.name}.`;
}

export async function removeAccessRule(ruleId: string) {
  await db.programAccessRule.deleteMany({ where: { id: ruleId } });
}

export class AccessRuleError extends Error {}

/** Thrown where a limited account tries something its rules don't allow (shown as is). */
export class AccessDeniedError extends Error {}

/** For uploads, the Hub and other Coursebook-wide features: refuse accounts limited to a program. */
export async function assertCoursebookAllowed(userId: string) {
  const rules = await programAccess(userId);
  if (!allowsCoursebook(rules)) throw new AccessDeniedError(ONLY_MESSAGE(rules));
}

/** A student's membership in a class that their rules also allow. */
export async function isAllowedMember(userId: string, classId: string) {
  const m = await db.classMember.findUnique({ where: { classId_userId: { classId, userId } }, select: { class: { select: { programId: true } } } });
  return Boolean(m) && allowsProgram(await programAccess(userId), m!.class.programId);
}
