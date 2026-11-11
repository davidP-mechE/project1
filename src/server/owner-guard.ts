import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { getSession } from "./session";
import { isOwnerRow } from "./roles";

/** Pages for the owner only. Anyone else, signed in or not, gets the site's plain 404. */
export async function requireOwner() {
  const session = await getSession();
  const u = session ? await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, emailVerified: true, role: true, name: true } }) : null;
  if (!isOwnerRow(u)) notFound();
  return u!;
}

/** For route handlers: the owner's id, or null (the caller answers 404). */
export async function ownerIdOrNull(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const u = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, emailVerified: true, role: true } });
  return isOwnerRow(u) ? u!.id : null;
}
