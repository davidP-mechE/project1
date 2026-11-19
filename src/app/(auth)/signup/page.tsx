import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { env, googleAuthEnabled } from "@/server/env";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSession()) redirect(next);
  // Every new account starts in the featured program (The 1600 Project) as a mentee; only an admin can change that.
  const program = env.FEATURED_PROGRAM_SLUG ? await db.program.findUnique({ where: { slug: env.FEATURED_PROGRAM_SLUG }, select: { name: true } }) : null;
  return <SignupForm googleEnabled={googleAuthEnabled} next={next} programName={program?.name ?? null} />;
}
