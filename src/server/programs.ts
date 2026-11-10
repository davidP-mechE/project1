import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, ClassError } from "./access";
import { sendEmail } from "./email";
import { adminTransferMessage } from "./email/templates";

/**
 * Programs: a tutoring program (e.g. The 1600 Project) owns classes, staff and
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
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return db.program.create({ data: { adminId: userId, name: `${user.name?.trim() || "My"}'s tutoring program` } });
}

export async function createProgram(userId: string, name: string) {
  const n = name.trim().slice(0, 120);
  if (!n) throw new ClassError("Give the program a name.");
  if ((await db.program.count({ where: { adminId: userId } })) >= 5) throw new ClassError("You can run up to 5 programs.");
  return db.program.create({ data: { adminId: userId, name: n } });
}

/** Programs the person runs or works in. */
export async function myPrograms(userId: string) {
  const rows = await db.program.findMany({
    where: { OR: [{ adminId: userId }, { classes: { some: { staff: { some: { userId } } } } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, adminId: true, admin: { select: { name: true } }, _count: { select: { classes: true } } },
  });
  return rows.map((p) => ({ ...p, isAdmin: p.adminId === userId }));
}

async function adminProgram(userId: string, programId: string) {
  const p = await db.program.findFirst({ where: { id: programId, adminId: userId } });
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
export async function getProgram(userId: string, programId: string) {
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
  const log = await db.auditLog.findMany({ where: { programId }, orderBy: { createdAt: "desc" }, take: 100 });
  const actors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(log.flatMap((l) => (l.actorId ? [l.actorId] : [])))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { program: p, staff: staff.map((s) => s.user), log: log.map((l) => ({ ...l, actorName: l.actorId ? (actors.get(l.actorId) ?? "Deleted user") : "System" })) };
}

export async function updateProgram(userId: string, programId: string, patch: { name?: string; targets?: number[]; inviteDays?: number; aiDailyCapCents?: number | null; testDates?: string[] }) {
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
  await db.$transaction(async (tx) => {
    await tx.program.update({ where: { id: p.id }, data });
    await audit(tx, { programId: p.id, actorId: userId, action: "program.update", targetType: "program", targetId: p.id, summary: `Program settings changed: ${Object.keys(data).join(", ")}`, before: { name: p.name, targets: p.targets, inviteDays: p.inviteDays, aiDailyCapCents: p.aiDailyCapCents }, after: data });
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
