import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

/** Current session or null. Cached so a page can call it many times per request. */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export type CurrentUser = { id: string; name: string; email: string; role: string; image?: string | null };

/** Require a logged-in, verified user; otherwise redirect to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id, name, email, image } = session.user;
  return { id, name, email, image, role: (session.user as { role?: string }).role ?? "USER" };
}

/** The signed-in person's timezone (Settings → Studying), for formatting dates. Cached per request. */
export const viewerZone = cache(async (): Promise<string> => {
  const session = await getSession();
  if (!session) return "UTC";
  const { db } = await import("./db");
  const u = await db.user.findUnique({ where: { id: session.user.id }, select: { timezone: true } });
  return u?.timezone || "UTC";
});
