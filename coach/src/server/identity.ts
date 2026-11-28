import "server-only";
import { cookies } from "next/headers";
import { sign, verify } from "./crypto";
import { createUser, getUser, type UserRow } from "./store";
import { env } from "./env";

/**
 * Prototype identity: an anonymous account bound to a signed, httpOnly cookie.
 * The spec calls for a managed auth provider (Clerk, Auth0 or Supabase Auth)
 * before beta; this is the seam it plugs into.
 */
const COOKIE = "coach_uid";

export async function currentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const id = verify(store.get(COOKIE)?.value);
  return id ? getUser(id) : null;
}

/** Route handlers only (cookies can't be set while rendering). */
export async function currentOrNewUser(): Promise<UserRow> {
  const existing = await currentUser();
  if (existing) return existing;
  const user = await createUser();
  const store = await cookies();
  store.set(COOKIE, sign(user.id), { httpOnly: true, sameSite: "lax", secure: env.production, path: "/", maxAge: 60 * 60 * 24 * 400 });
  return user;
}

export async function forgetIdentity() {
  (await cookies()).delete(COOKIE);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Every coaching endpoint requires an adult account (spec: "18+ at launch with an age gate"). */
export async function requireAdult(): Promise<UserRow> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "No account yet.");
  if (!user.age_confirmed_at) throw new HttpError(403, "Please confirm you're 18 or older first.");
  return user;
}

export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e) => {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
  });
}
