import "server-only";
import { AccessRuleError, allowsCoursebook, allowsProgram, normalizeEmail, ONLY_MESSAGE, programAccess, programIdFilter, setAccessRule } from "./program-access";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, ClassError } from "./access";
import { sendEmail } from "./email";
import { adminTransferMessage } from "./email/templates";

/**
 * Programs: a tutoring program (such as a school's SAT program) owns classes, staff and
 * settings. It has exactly one admin, who can hand the role to someone else.
 */

type Tx = Prisma.TransactionClient | typeof db;

/** Append one row to the audit log. Nothing ever updates or deletes these rows. */
export async function audit(
  tx: Tx,
  entry: { programId: string; actorId: string | null; action: string; targetType: string; targetId: string; summary: string; before?: unknown; after?: unknown },
) {
  await tx.auditLog.create({
    data: {
      programId: entry.programId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      summary: entry.summary.slice(0, 500),
      before: entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
    },
  });
}

/** The program a new class goes in: the chosen one (caller must be its admin), their first, or a new one. */
export async function ensureProgramFor(userId: string, programId?: string) {
  if (programId) {
    const p = await db.program.findFirst({ where: { id: programId, adminId: userId } });
    if (!p) throw new ClassError("Only the program admin can add classes to it.", 403);
    return p;
  }
  const mine = await db.program.findFirst({ where: { adminId: userId }, orderBy: { createdAt: "asc" } });
  if (mine) return mine;
  const rules = await programAccess(userId);
  if (!allowsCoursebook(rules)) throw new ClassError(ONLY_MESSAGE(rules), 403);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return db.program.create({ data: { adminId: userId, name: `${user.name?.trim() || "My"}'s tutoring program` } });
}

export async function createProgram(userId: string, name: string) {
  const n = name.trim().slice(0, 120);
  if (!n) throw new ClassError("Give the program a name.");
  const rules = await programAccess(userId);
  if (!allowsCoursebook(rules)) throw new ClassError(ONLY_MESSAGE(rules), 403);
  if ((await db.program.count({ where: { adminId: userId } })) >= 5) throw new ClassError("You can run up to 5 programs.");
  return db.program.create({ data: { adminId: userId, name: n } });
}

/** Programs the person runs or works in. */
export async function myPrograms(userId: string) {
  const allowed = programIdFilter(await programAccess(userId));
  const rows = await db.program.findMany({
    where: { OR: [{ adminId: userId }, { classes: { some: { staff: { some: { userId } } } } }], ...(allowed ? { id: allowed } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, badge: true, adminId: true, admin: { select: { name: true } }, _count: { select: { classes: true } } },
  });
  return rows.map((p) => ({ ...p, isAdmin: p.adminId === userId }));
}

async function adminProgram(userId: string, programId: string) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: userId } });
  if (p && !allowsProgram(await programAccess(userId), programId)) throw new NotFoundError("Program not found");
  if (!p) {
    // Staff see "only the admin" rather than "not found", since they know it exists.
    const staff = await db.program.count({ where: { id: programId, classes: { some: { staff: { some: { userId } } } } } });
    if (staff) throw new ClassError("Only the program admin can do that.", 403);
    throw new NotFoundError("Program not found");
  }
  await assertStaffTwoFactor(userId);
  return p;
}

/** The program page: settings, classes and staff (for the transfer list), and the audit log. Admin only. */
const LOG_PAGE = 50;

export async function getProgram(userId: string, programId: string, opts: { logBefore?: string } = {}) {
  await adminProgram(userId, programId);
  const p = await db.program.findUniqueOrThrow({
    where: { id: programId },
    include: {
      admin: { select: { id: true, name: true, email: true } },
      classes: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, archivedAt: true, _count: { select: { members: true } } } },
    },
  });
  const staff = await db.classStaff.findMany({
    where: { class: { programId }, userId: { not: p.adminId } },
    distinct: ["userId"],
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const rows = await db.auditLog.findMany({ where: { programId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: LOG_PAGE + 1, ...(opts.logBefore ? { cursor: { id: opts.logBefore }, skip: 1 } : {}) });
  const log = rows.slice(0, LOG_PAGE);
  const logOlder = rows.length > LOG_PAGE ? log.at(-1)!.id : null;
  const actors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(log.flatMap((l) => (l.actorId ? [l.actorId] : [])))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { program: p, staff: staff.map((s) => s.user), logOlder, log: log.map((l) => ({ ...l, actorName: l.actorId ? (actors.get(l.actorId) ?? "Deleted user") : "System" })) };
}

export type ProgramPatch = {
  /** Students who join a class in this program get an "SAT only, no AI" rule. */
  newStudentsNoAi?: boolean;
  name?: string;
  targets?: number[];
  inviteDays?: number;
  aiDailyCapCents?: number | null;
  testDates?: string[];
  /** Public page: /p/<slug>, its badge text and copy. */
  slug?: string | null;
  badge?: string | null;
  isPublic?: boolean;
  publicBlurb?: string | null;
  schoolAverage?: number | null;
  goalGain?: number | null;
};

const RESERVED_SLUGS = new Set(["new", "admin", "api", "login", "signup", "help"]);

export async function updateProgram(userId: string, programId: string, patch: ProgramPatch) {
  const p = await adminProgram(userId, programId);
  const data: Prisma.ProgramUpdateInput = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim().slice(0, 120);
    if (!n) throw new ClassError("Give the program a name.");
    data.name = n;
  }
  if (patch.targets !== undefined) {
    const t = [...new Set(patch.targets.map((x) => Math.round(x / 10) * 10))].filter((x) => x >= 400 && x <= 1600).sort((a, b) => a - b).slice(0, 4);
    data.targets = t;
  }
  if (patch.inviteDays !== undefined) {
    if (!Number.isInteger(patch.inviteDays) || patch.inviteDays < 1 || patch.inviteDays > 30) throw new ClassError("Invites can last 1 to 30 days.");
    data.inviteDays = patch.inviteDays;
  }
  if (patch.aiDailyCapCents !== undefined) {
    if (patch.aiDailyCapCents !== null && (!Number.isInteger(patch.aiDailyCapCents) || patch.aiDailyCapCents < 0 || patch.aiDailyCapCents > 100_000)) throw new ClassError("The daily AI cap can be $0 to $1,000.");
    data.aiDailyCapCents = patch.aiDailyCapCents;
  }
  if (patch.testDates !== undefined) {
    const dates = [...new Set(patch.testDates.map((d) => d.trim()).filter(Boolean))].slice(0, 20).map((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(`${d}T12:00:00Z`).getTime())) throw new ClassError(`"${d}" isn't a date like 2027-03-13.`);
      return new Date(`${d}T12:00:00Z`);
    });
    data.testDates = dates.sort((a, b) => a.getTime() - b.getTime());
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug?.trim().toLowerCase() || null;
    if (slug && (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) || RESERVED_SLUGS.has(slug))) throw new ClassError("The page address can use lowercase letters, numbers and dashes (up to 40).");
    if (slug && (await db.program.count({ where: { slug, id: { not: p.id } } }))) throw new ClassError("Another program already uses that address.");
    data.slug = slug;
  }
  if (patch.badge !== undefined) {
    const b = patch.badge?.trim().toUpperCase() || null;
    if (b && !/^[A-Z0-9]{1,4}$/.test(b)) throw new ClassError("The badge can be up to 4 letters or numbers.");
    data.badge = b;
  }
  if (patch.publicBlurb !== undefined) data.publicBlurb = patch.publicBlurb?.trim().slice(0, 1000) || null;
  for (const k of ["schoolAverage", "goalGain"] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v !== null && (!Number.isInteger(v) || v < (k === "goalGain" ? 10 : 400) || v > (k === "goalGain" ? 1200 : 1600))) throw new ClassError(k === "goalGain" ? "The goal gain is 10 to 1,200 points." : "The starting average is 400 to 1600.");
    data[k] = v;
  }
  if (patch.newStudentsNoAi !== undefined) data.newStudentsNoAi = Boolean(patch.newStudentsNoAi);
  if (patch.isPublic !== undefined) {
    if (patch.isPublic && !(data.slug ?? p.slug)) throw new ClassError("Choose a page address before making the page public.");
    data.isPublic = patch.isPublic;
  }
  await db.$transaction(async (tx) => {
    await tx.program.update({ where: { id: p.id }, data });
    await audit(tx, { programId: p.id, actorId: userId, action: "program.update", targetType: "program", targetId: p.id, summary:
        Object.keys(data).length === 1 && data.newStudentsNoAi !== undefined
          ? data.newStudentsNoAi
            ? "New students who join are now SAT only, no AI"
            : "New students who join are no longer set to SAT only, no AI"
          : `Program settings changed: ${Object.keys(data).join(", ")}`, before: { name: p.name, targets: p.targets, inviteDays: p.inviteDays, aiDailyCapCents: p.aiDailyCapCents }, after: data });
  });
}

/**
 * Hand the admin role to a staff member of the program. The old admin stays
 * on every class as a teacher (they can remove themselves later). The site
 * admin can also do this, to recover a program whose admin has left.
 */
export async function transferAdmin(actorId: string, programId: string, input: { toUserId: string; confirmName: string }, opts: { asSiteAdmin?: boolean } = {}) {
  const p = opts.asSiteAdmin ? await db.program.findUnique({ where: { id: programId } }) : await adminProgram(actorId, programId);
  if (!p) throw new NotFoundError("Program not found");
  if (input.confirmName.trim() !== p.name) throw new ClassError("Type the program's name exactly to confirm.");
  if (input.toUserId === p.adminId) throw new ClassError("They're already the admin.");
  const isStaff = await db.classStaff.count({ where: { userId: input.toUserId, class: { programId } } });
  if (!isStaff) throw new ClassError("Choose someone on the program's staff. Add them to a class first.");
  if (!allowsProgram(await programAccess(input.toUserId), programId)) throw new ClassError("A site admin has limited that account, so it can't run this program.", 403);
  const [from, to] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: p.adminId }, select: { id: true, name: true } }),
    db.user.findUniqueOrThrow({ where: { id: input.toUserId }, select: { id: true, name: true, email: true } }),
  ]);
  const classes = await db.class.findMany({ where: { programId }, select: { id: true } });
  await db.$transaction(async (tx) => {
    await tx.program.update({ where: { id: programId }, data: { adminId: to.id } });
    for (const c of classes) {
      await tx.classStaff.upsert({ where: { classId_userId: { classId: c.id, userId: from.id } }, create: { classId: c.id, userId: from.id, role: "TEACHER", addedById: actorId }, update: {} });
    }
    await audit(tx, { programId, actorId, action: "program.transfer", targetType: "user", targetId: to.id, summary: `Admin role transferred from ${from.name} to ${to.name}`, before: { adminId: from.id }, after: { adminId: to.id } });
  });
  await sendEmail(adminTransferMessage({ to: to.email, fromName: from.name || "The previous admin", programName: p.name, url: `${env.APP_URL}/teach/programs/${programId}` })).catch((err) => {
    console.warn("[programs] transfer email not sent:", err instanceof Error ? err.message : err);
  });
}

/** A program's public page, by its address; null unless the admin made it public. Only public fields. */
export async function publicProgram(slug: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  return db.program.findFirst({
    where: { slug, isPublic: true },
    select: { id: true, name: true, slug: true, badge: true, subject: true, publicBlurb: true, schoolAverage: true, goalGain: true, targets: true },
  });
}

/** The programs a student is in (through their classes), with those class names. Empty for students in no program class. */
export async function studentPrograms(userId: string) {
  const allowed = programIdFilter(await programAccess(userId));
  const rows = await db.classMember.findMany({
    where: { userId, class: { archivedAt: null, ...(allowed ? { programId: allowed } : {}) } },
    select: { class: { select: { name: true, program: { select: { id: true, name: true, badge: true } } } } },
    orderBy: { joinedAt: "asc" },
  });
  const out = new Map<string, { id: string; name: string; badge: string | null; classes: string[] }>();
  for (const r of rows) {
    const p = r.class.program;
    const e = out.get(p.id) ?? { ...p, classes: [] };
    e.classes.push(r.class.name);
    out.set(p.id, e);
  }
  return [...out.values()];
}

// ── Program access (the program admin's own rules; site admins manage every program's in Admin) ──

/** This program's access rules, for its admin. */
export async function programAccessRules(userId: string, programId: string) {
  await adminProgram(userId, programId);
  return db.programAccessRule.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, mode: true, noAi: true, note: true, createdAt: true } });
}

/** The program admin limits an email to this program, or blocks it from this program. Logged in the audit log. */
export async function setProgramAccessRule(userId: string, programId: string, input: { email: string; mode: "ONLY" | "BLOCKED" | "SAT_ONLY"; note?: string | null }) {
  const p = await adminProgram(userId, programId);
  const me = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  if (normalizeEmail(input.email) === normalizeEmail(me.email)) throw new ClassError("You can't set a rule for your own account.");
  const before = await db.programAccessRule.findUnique({ where: { email_programId: { email: normalizeEmail(input.email), programId } }, select: { mode: true, noAi: true } });
  let message: string;
  try {
    message = await setAccessRule(userId, { ...input, programId });
  } catch (err) {
    if (err instanceof AccessRuleError) throw new ClassError(err.message);
    throw err;
  }
  const email = normalizeEmail(input.email);
  await audit(db, { programId, actorId: userId, action: "access.set", targetType: "email", targetId: email, summary: input.mode === "SAT_ONLY" ? `Set ${email} to ${p.name} only, no AI` : input.mode === "ONLY" ? `Limited ${email} to ${p.name} only` : `Blocked ${email} from ${p.name}`, before: before ?? undefined, after: { mode: input.mode } });
  return message;
}

export async function removeProgramAccessRule(userId: string, programId: string, ruleId: string) {
  const p = await adminProgram(userId, programId);
  const rule = await db.programAccessRule.findFirst({ where: { id: ruleId, programId }, select: { id: true, email: true, mode: true, noAi: true } });
  if (!rule) throw new NotFoundError("Rule not found");
  await db.programAccessRule.delete({ where: { id: rule.id } });
  await audit(db, { programId, actorId: userId, action: "access.remove", targetType: "email", targetId: rule.email, summary: `Removed the rule ${rule.mode === "ONLY" ? `limiting ${rule.email} to ${p.name}${rule.noAi ? " with no AI" : ""}` : `blocking ${rule.email} from ${p.name}`}`, before: { mode: rule.mode, noAi: rule.noAi } });
}

/**
 * A student just joined one of this program's classes: if the program's
 * "New students who join are SAT only, no AI" setting is on, give them that rule
 * (unless they already have a rule for this program, or are a site admin, the
 * owner or the program's admin). Logged in the program's audit log.
 */
export async function applyNewStudentDefault(userId: string, programId: string) {
  const p = await db.program.findUnique({ where: { id: programId }, select: { id: true, name: true, adminId: true, newStudentsNoAi: true } });
  if (!p?.newStudentsNoAi || p.adminId === userId) return false;
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, role: true } });
  if (!u || u.role === "ADMIN" || u.role === "OWNER") return false;
  const email = normalizeEmail(u.email);
  if (await db.programAccessRule.findUnique({ where: { email_programId: { email, programId } }, select: { id: true } })) return false;
  await db.$transaction(async (tx) => {
    await tx.programAccessRule.create({ data: { email, programId, mode: "ONLY", noAi: true, note: "Joined a class while new students were set to SAT only, no AI" } });
    await audit(tx, { programId, actorId: null, action: "access.set", targetType: "email", targetId: email, summary: `Set ${email} to ${p.name} only, no AI (joined a class; the program's default for new students)`, after: { mode: "SAT_ONLY" } });
  });
  return true;
}

/**
 * Sign-up choice "As a <program> mentee": at the account's first sign-in (only
 * possible once the email is verified), give it that program's "SAT only, no AI"
 * rule, unless it already has a rule there, then clear the choice. Only the
 * address's owner can trigger this, so nobody can put someone else's email into
 * the mode. Logged in the program's audit log.
 */
export async function applySignupMentee(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, role: true, emailVerified: true, signupProgramId: true } });
  if (!u?.signupProgramId || !u.emailVerified) return false;
  const programId = u.signupProgramId;
  await db.user.update({ where: { id: userId }, data: { signupProgramId: null } });
  if (u.role === "ADMIN" || u.role === "OWNER") return false;
  const p = await db.program.findFirst({ where: { id: programId, isPublic: true }, select: { id: true, name: true, adminId: true } });
  if (!p || p.adminId === userId) return false;
  const email = normalizeEmail(u.email);
  if (await db.programAccessRule.findUnique({ where: { email_programId: { email, programId } }, select: { id: true } })) return false;
  await db.$transaction(async (tx) => {
    await tx.programAccessRule.create({ data: { email, programId, mode: "ONLY", noAi: true, note: "Signed up as a mentee" } });
    await audit(tx, { programId, actorId: userId, action: "access.set", targetType: "email", targetId: email, summary: `${email} signed up as a ${p.name} mentee (${p.name} only, no AI)`, after: { mode: "SAT_ONLY" } });
  });
  return true;
}
