import "server-only";
import { allowsProgram, programAccess, programDeniedMessage } from "./program-access";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { classAccess, ClassError, can } from "./access";
import { audit } from "./programs";
import { rateLimit } from "./rate-limit";
import { sendEmail } from "./email";
import { staffAddedMessage, staffInviteMessage } from "./email/templates";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { isDomain, isSection, scopeLabel } from "@/lib/sat/domains";

/**
 * Staff on a class: teachers, specialists (scoped to subjects and/or groups)
 * and viewers. Only the program admin, or a teacher they allow, adds, changes
 * or removes staff. Every change is written to the audit log.
 */

export type StaffRoleInput = "TEACHER" | "SPECIALIST" | "VIEWER";
export type StaffInput = { role: StaffRoleInput; sections?: string[]; domains?: string[]; groupIds?: string[]; canManageStaff?: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_NAME: Record<string, string> = { TEACHER: "Teacher", SPECIALIST: "Specialist", VIEWER: "Viewer", ADMIN: "Program admin" };
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Check and clean a role and scope. Only specialists have a scope; only the admin can grant staff management. */
async function cleanScope(classId: string, input: StaffInput, actorIsAdmin: boolean) {
  if (!["TEACHER", "SPECIALIST", "VIEWER"].includes(input.role)) throw new ClassError("Choose a role.");
  if (input.role !== "SPECIALIST") {
    if (input.canManageStaff && input.role !== "TEACHER") throw new ClassError("Only teachers can be allowed to manage staff.");
    if (input.canManageStaff && !actorIsAdmin) throw new ClassError("Only the program admin can let a teacher manage staff.", 403);
    return { role: input.role, sections: [], domains: [], groupIds: [], canManageStaff: input.role === "TEACHER" && Boolean(input.canManageStaff) };
  }
  const sections = [...new Set((input.sections ?? []).filter(isSection))];
  const domains = [...new Set((input.domains ?? []).filter(isDomain))];
  const wanted = [...new Set(input.groupIds ?? [])];
  const groups = wanted.length ? await db.classGroup.findMany({ where: { id: { in: wanted }, classId }, select: { id: true } }) : [];
  if (groups.length !== wanted.length) throw new ClassError("Some of those groups aren't in this class.");
  if (!sections.length && !domains.length && !groups.length) throw new ClassError("Choose the subjects or groups this specialist covers.");
  return { role: input.role, sections, domains, groupIds: groups.map((g) => g.id), canManageStaff: false };
}

async function describe(classId: string, s: { role: string; sections: string[]; domains: string[]; groupIds: string[]; canManageStaff?: boolean }) {
  if (s.role !== "SPECIALIST") return `${ROLE_NAME[s.role]}${s.canManageStaff ? " (can manage staff)" : ""}`;
  const groups = s.groupIds.length ? await db.classGroup.findMany({ where: { id: { in: s.groupIds }, classId }, select: { name: true } }) : [];
  const subjects = s.sections.length || s.domains.length ? scopeLabel(s) : "";
  return `Specialist (${[subjects, groups.length ? `groups: ${groups.map((g) => g.name).join(", ")}` : ""].filter(Boolean).join("; ")})`;
}

/** The Staff page: everyone on the class, and pending invites (for people who manage staff). */
export async function listStaff(userId: string, classId: string, now = new Date()) {
  const access = await classAccess(userId, classId);
  const manage = can(access, "manageStaff");
  const c = await db.class.findUniqueOrThrow({
    where: { id: classId },
    select: {
      name: true,
      program: { select: { id: true, name: true, admin: { select: { id: true, name: true, email: true, lastLoginAt: true } } } },
      staff: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, sections: true, domains: true, groupIds: true, canManageStaff: true, createdAt: true, user: { select: { id: true, name: true, email: true, lastLoginAt: true } } } },
      staffInvites: manage ? { where: { acceptedAt: null, cancelledAt: null }, orderBy: { createdAt: "desc" } } : false,
      groups: { orderBy: { name: "asc" }, select: { id: true, name: true } },
    },
  });
  const groupName = new Map(c.groups.map((g) => [g.id, g.name]));
  const label = (s: { role: string; sections: string[]; domains: string[]; groupIds: string[] }) =>
    s.role !== "SPECIALIST" ? "Everything in the class" : [s.sections.length || s.domains.length ? scopeLabel(s) : "All subjects", s.groupIds.length ? s.groupIds.map((g) => groupName.get(g) ?? "a deleted group").join(", ") : "all students"].join(" · ");
  const admin = c.program.admin;
  const rows = [
    { userId: admin.id, name: admin.name, email: manage ? admin.email : null, role: "ADMIN" as const, scopeText: "Everything in the program", sections: [], domains: [], groupIds: [], canManageStaff: true, lastLoginAt: manage ? admin.lastLoginAt : null, isProgramAdmin: true },
    ...c.staff
      .filter((s) => s.user.id !== admin.id)
      .map((s) => ({
        userId: s.user.id,
        name: s.user.name,
        email: manage ? s.user.email : null,
        role: s.role,
        scopeText: label(s),
        sections: s.sections,
        domains: s.domains,
        groupIds: s.groupIds,
        canManageStaff: s.canManageStaff,
        lastLoginAt: manage ? s.user.lastLoginAt : null,
        isProgramAdmin: false,
      })),
  ];
  const invites = (c.staffInvites || []).map((i) => ({ id: i.id, email: i.email, role: i.role, scopeText: label(i), createdAt: i.createdAt, expiresAt: i.expiresAt, expired: i.expiresAt <= now }));
  return { className: c.name, program: { id: c.program.id, name: c.program.name }, access, manage, isAdmin: access.isProgramAdmin, staff: rows, invites, groups: c.groups };
}

async function sendInvite(invite: { id: string; email: string; role: string; classId: string }, token: string, byName: string, className: string, scope: string, days: number) {
  // Name the program too ("SAT Fall (The 1600 Project)"): the site is Coursebook, the class belongs to a program on it.
  const program = (await db.class.findUnique({ where: { id: invite.classId }, select: { program: { select: { name: true } } } }))?.program.name;
  await sendEmail(staffInviteMessage({ to: invite.email, byName, className: program ? `${className} (${program})` : className, role: invite.role, scope, url: `${env.APP_URL}/staff-invite/${token}`, days })).catch((err) => {
    console.warn("[staff] invite email not sent:", err instanceof Error ? err.message : err);
  });
}

/**
 * Add someone by email. With an account they're added right away and told by
 * email; without one they get an invite link that expires.
 */
export async function addStaff(userId: string, classId: string, rawEmail: string, input: StaffInput, now = new Date()): Promise<{ added: true } | { invited: true }> {
  const access = await classAccess(userId, classId, "manageStaff");
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new ClassError("Enter a valid email address.");
  const scope = await cleanScope(classId, input, access.isProgramAdmin);
  const limited = await rateLimit(RATE_RULES.staffInvite, userId);
  if (!limited.ok) throw new ClassError("You've added a lot of staff today. Please try again tomorrow.", 429);
  const [c, actor, existing] = await Promise.all([
    db.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, programId: true, program: { select: { adminId: true, inviteDays: true, name: true } } } }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, name: true, email: true } }),
  ]);
  const summary = await describe(classId, scope);
  if (existing) {
    if (existing.id === c.program.adminId) throw new ClassError("That's the program admin, who already has full access.");
    if (!allowsProgram(await programAccess(existing.id), c.programId)) throw new ClassError("A site admin has limited that account, so it can't be added to this program.", 403);
    if (await db.classStaff.findUnique({ where: { classId_userId: { classId, userId: existing.id } } })) throw new ClassError("They're already on this class's staff. Change their role below instead.");
    if (await db.classMember.findUnique({ where: { classId_userId: { classId, userId: existing.id } } })) throw new ClassError("They're a student in this class. Remove them as a student first.");
    await db.$transaction(async (tx) => {
      await tx.classStaff.create({ data: { classId, userId: existing.id, addedById: userId, ...scope } });
      await audit(tx, { programId: c.programId, actorId: userId, action: "staff.add", targetType: "user", targetId: existing.id, summary: `Added ${existing.name || existing.email} to ${c.name} as ${summary}`, after: scope });
    });
    await sendEmail(staffAddedMessage({ to: existing.email, byName: actor.name || "The program admin", className: `${c.name} (${c.program.name})`, role: scope.role, scope: summary, url: `${env.APP_URL}/teach/${classId}` })).catch((err) => {
      console.warn("[staff] notification not sent:", err instanceof Error ? err.message : err);
    });
    return { added: true };
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + c.program.inviteDays * 86_400_000);
  const invite = await db.$transaction(async (tx) => {
    // A new invite to the same address replaces any pending one.
    await tx.staffInvite.updateMany({ where: { classId, email, acceptedAt: null, cancelledAt: null }, data: { cancelledAt: now } });
    const inv = await tx.staffInvite.create({ data: { classId, email, invitedById: userId, tokenHash: hashToken(token), expiresAt, ...scope } });
    await audit(tx, { programId: c.programId, actorId: userId, action: "staff.invite", targetType: "invite", targetId: inv.id, summary: `Invited ${email} to ${c.name} as ${summary}`, after: scope });
    return inv;
  });
  await sendInvite(invite, token, actor.name || "The program admin", c.name, summary, c.program.inviteDays);
  return { invited: true };
}

/** Change a staff member's role or scope. Takes effect on their next request. */
export async function updateStaff(userId: string, classId: string, staffUserId: string, input: StaffInput) {
  const access = await classAccess(userId, classId, "manageStaff");
  const row = await db.classStaff.findUnique({ where: { classId_userId: { classId, userId: staffUserId } }, include: { user: { select: { name: true, email: true } } } });
  if (!row) throw new NotFoundError("Staff member not found");
  if (!access.isProgramAdmin && row.canManageStaff) throw new ClassError("Only the program admin can change a teacher who manages staff.", 403);
  if (!access.isProgramAdmin && staffUserId === userId) throw new ClassError("Ask the program admin to change your own role.", 403);
  // Keeping an existing grant is fine for a non-admin; only adding one needs the admin.
  const scope = await cleanScope(classId, { ...input, canManageStaff: access.isProgramAdmin ? input.canManageStaff : false }, access.isProgramAdmin);
  const [before, after] = [await describe(classId, row), await describe(classId, scope)];
  await db.$transaction(async (tx) => {
    await tx.classStaff.update({ where: { id: row.id }, data: scope });
    await audit(tx, {
      programId: access.programId,
      actorId: userId,
      action: "staff.update",
      targetType: "user",
      targetId: staffUserId,
      summary: `${row.user.name || row.user.email} in ${access.className}: ${before} → ${after}`,
      before: { role: row.role, sections: row.sections, domains: row.domains, groupIds: row.groupIds, canManageStaff: row.canManageStaff },
      after: scope,
    });
  });
}

/** Remove someone from the class's staff, effective on their very next request. */
export async function removeStaff(userId: string, classId: string, staffUserId: string) {
  const access = await classAccess(userId, classId, "manageStaff");
  const row = await db.classStaff.findUnique({ where: { classId_userId: { classId, userId: staffUserId } }, include: { user: { select: { name: true, email: true } } } });
  if (!row) throw new NotFoundError("Staff member not found");
  if (!access.isProgramAdmin && row.canManageStaff && staffUserId !== userId) throw new ClassError("Only the program admin can remove a teacher who manages staff.", 403);
  await db.$transaction(async (tx) => {
    await tx.classStaff.delete({ where: { id: row.id } });
    await audit(tx, {
      programId: access.programId,
      actorId: userId,
      action: "staff.remove",
      targetType: "user",
      targetId: staffUserId,
      summary: `Removed ${row.user.name || row.user.email} (${await describe(classId, row)}) from ${access.className}`,
      before: { role: row.role, sections: row.sections, domains: row.domains, groupIds: row.groupIds },
    });
  });
}

/** Send a pending invite again, with a fresh link and expiry (the old link stops working). */
export async function resendStaffInvite(userId: string, classId: string, inviteId: string, now = new Date()) {
  const access = await classAccess(userId, classId, "manageStaff");
  const inv = await db.staffInvite.findFirst({ where: { id: inviteId, classId, acceptedAt: null, cancelledAt: null } });
  if (!inv) throw new NotFoundError("Invite not found");
  const limited = await rateLimit(RATE_RULES.staffInvite, userId);
  if (!limited.ok) throw new ClassError("You've sent a lot of invites today. Please try again tomorrow.", 429);
  const c = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, program: { select: { inviteDays: true } } } });
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.staffInvite.update({ where: { id: inv.id }, data: { tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + c.program.inviteDays * 86_400_000) } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "staff.invite.resend", targetType: "invite", targetId: inv.id, summary: `Resent the invite to ${inv.email}` });
  });
  const actor = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  await sendInvite(inv, token, actor.name || "The program admin", c.name, await describe(classId, inv), c.program.inviteDays);
}

export async function cancelStaffInvite(userId: string, classId: string, inviteId: string, now = new Date()) {
  const access = await classAccess(userId, classId, "manageStaff");
  const inv = await db.staffInvite.findFirst({ where: { id: inviteId, classId, acceptedAt: null, cancelledAt: null } });
  if (!inv) throw new NotFoundError("Invite not found");
  await db.$transaction(async (tx) => {
    await tx.staffInvite.update({ where: { id: inv.id }, data: { cancelledAt: now } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "staff.invite.cancel", targetType: "invite", targetId: inv.id, summary: `Cancelled the invite to ${inv.email}` });
  });
}

/** What the invite page shows (no account details beyond the invited address). */
export async function staffInviteByToken(token: string, now = new Date()) {
  const inv = await db.staffInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { class: { select: { name: true } } } });
  if (!inv) return null;
  const state = inv.cancelledAt ? "cancelled" : inv.acceptedAt ? "accepted" : inv.expiresAt <= now ? "expired" : "pending";
  return { email: inv.email, role: inv.role, className: inv.class.name, classId: inv.classId, state } as const;
}

/** Accept an invite. The signed-in account must have the invited email address. */
export async function acceptStaffInvite(userId: string, token: string, now = new Date()) {
  const inv = await db.staffInvite.findUnique({ where: { tokenHash: hashToken(token) }, include: { class: { select: { name: true, programId: true, program: { select: { adminId: true } } } } } });
  if (!inv || inv.cancelledAt) throw new ClassError("This invite link isn't valid any more. Ask for a new one.", 404);
  if (inv.acceptedAt) throw new ClassError("This invite has already been used.", 409);
  if (inv.expiresAt <= now) throw new ClassError("This invite has expired. Ask the program admin to resend it.", 410);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) throw new ClassError(`This invite is for ${inv.email}. Sign in with that address to accept it.`, 403);
  if (await db.classMember.findUnique({ where: { classId_userId: { classId: inv.classId, userId } } })) throw new ClassError("You're a student in this class, so you can't also be on its staff.");
  const rules = await programAccess(userId);
  if (!allowsProgram(rules, inv.class.programId)) throw new ClassError(programDeniedMessage(rules), 403);
  await db.$transaction(async (tx) => {
    const claimed = await tx.staffInvite.updateMany({ where: { id: inv.id, acceptedAt: null, cancelledAt: null }, data: { acceptedAt: now } });
    if (claimed.count === 0) throw new ClassError("This invite has already been used.", 409);
    if (userId !== inv.class.program.adminId) {
      const scope = { role: inv.role, sections: inv.sections, domains: inv.domains, groupIds: inv.groupIds, canManageStaff: inv.canManageStaff };
      await tx.classStaff.upsert({ where: { classId_userId: { classId: inv.classId, userId } }, create: { classId: inv.classId, userId, addedById: inv.invitedById, ...scope }, update: scope });
    }
    await audit(tx, { programId: inv.class.programId, actorId: userId, action: "staff.invite.accept", targetType: "user", targetId: userId, summary: `${user.name || user.email} accepted the invite to ${inv.class.name}` });
  });
  return inv.classId;
}

/**
 * The program admin turns off a staff member's two-factor login (they lost
 * their phone and their backup codes). They're logged out everywhere and must
 * set it up again before seeing student data.
 */
export async function resetStaffTwoFactor(userId: string, classId: string, staffUserId: string) {
  const access = await classAccess(userId, classId, "manageStaff");
  if (!access.isProgramAdmin) throw new ClassError("Only the program admin can reset someone's two-factor login.", 403);
  const row = await db.classStaff.findUnique({ where: { classId_userId: { classId, userId: staffUserId } }, include: { user: { select: { name: true, email: true } } } });
  if (!row) throw new NotFoundError("Staff member not found");
  await db.$transaction(async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId: staffUserId } });
    await tx.user.update({ where: { id: staffUserId }, data: { twoFactorEnabled: false } });
    await tx.session.deleteMany({ where: { userId: staffUserId } });
    await audit(tx, { programId: access.programId, actorId: userId, action: "staff.reset-2fa", targetType: "user", targetId: staffUserId, summary: `Reset two-factor login for ${row.user.name || row.user.email}` });
  });
}
