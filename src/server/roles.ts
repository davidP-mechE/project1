import "server-only";
import { db } from "./db";

/**
 * Site roles for The 1600 Project features.
 *
 *   OWNER   the one person whose verified email is OWNER_EMAIL. Also a site admin.
 *   ADMIN   site admin (the existing Admin page and Hub publishing).
 *   TUTOR   approved by the owner: writes bank questions, sets and shared practice tests.
 *   USER    a student.
 *
 * No email is hard-coded: the owner comes from the OWNER_EMAIL environment
 * variable, synced at server start and at each login. Every check here reads
 * the database (and, for the owner, re-checks the email), so a change takes
 * effect on the next request. Seeing students is separate: that still needs
 * a staff place in the student's class (src/server/access.ts).
 */

export type SiteRole = "USER" | "TUTOR" | "ADMIN" | "OWNER";

/** The configured owner email, normalised; null when OWNER_EMAIL isn't set. */
export function ownerEmail(): string | null {
  const v = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return v ? v : null;
}

/** Site admins: the existing ADMIN role, and the owner. */
export const isSiteAdminRole = (role: string | null | undefined) => role === "ADMIN" || role === "OWNER";
/** May write bank questions and shared practice tests. */
export const isAuthorRole = (role: string | null | undefined) => role === "TUTOR" || role === "OWNER";

type RoleRow = { id: string; email: string; emailVerified: boolean; role: string };

/** True only for the OWNER role held by the account whose verified email matches OWNER_EMAIL right now. */
export function isOwnerRow(u: Pick<RoleRow, "email" | "emailVerified" | "role"> | null | undefined): boolean {
  const owner = ownerEmail();
  return Boolean(u && owner && u.role === "OWNER" && u.emailVerified && u.email.toLowerCase() === owner);
}

/**
 * Give OWNER to the verified account with OWNER_EMAIL, and take it from anyone
 * else (they go back to being a student). Safe to call often.
 */
export async function syncOwnerRole() {
  const owner = ownerEmail();
  const demoted = await db.user.updateMany({
    where: { role: "OWNER", ...(owner ? { NOT: { email: { equals: owner, mode: "insensitive" }, emailVerified: true } } : {}) },
    data: { role: "USER" },
  });
  let promoted = 0;
  if (owner) {
    promoted = (await db.user.updateMany({ where: { email: { equals: owner, mode: "insensitive" }, emailVerified: true, role: { not: "OWNER" } }, data: { role: "OWNER" } })).count;
    // Seeded studio courses made before the owner had an account are theirs.
    const u = await db.user.findFirst({ where: { email: { equals: owner, mode: "insensitive" }, emailVerified: true }, select: { id: true } });
    if (u) await db.studioCourse.updateMany({ where: { ownerId: null }, data: { ownerId: u.id } });
  }
  return { promoted, demoted: demoted.count };
}

/** Server-side role of a user id (for functions that take a userId). */
export async function roleOf(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerified: true, role: true } });
  const owner = isOwnerRow(u);
  return { row: u, isOwner: owner, isAuthor: owner || u?.role === "TUTOR", isSiteAdmin: owner || u?.role === "ADMIN" };
}

/** For functions given a userId: is that user the owner? */
export async function isOwner(userId: string | null | undefined) {
  if (!userId) return false;
  return (await roleOf(userId)).isOwner;
}

/** The owner sets someone's site role (approve or remove a tutor, grant or remove site admin). */
export async function setSiteRole(actorId: string, userId: string, role: "USER" | "TUTOR" | "ADMIN") {
  if (!(await isOwner(actorId))) throw new RoleError("Only the owner can change roles.", 403);
  if (actorId === userId) throw new RoleError("You can't change your own role (it comes from OWNER_EMAIL).");
  const target = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target) throw new RoleError("No such account.", 404);
  if (target.role === "OWNER") throw new RoleError("The owner's role comes from OWNER_EMAIL.");
  await db.user.update({ where: { id: userId }, data: { role } });
}

export class RoleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
