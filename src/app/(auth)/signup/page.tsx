import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { env, googleAuthEnabled } from "@/server/env";
import { publicProgram } from "@/server/programs";
import { getSession } from "@/server/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSession()) redirect(next);
  // A program to offer the "mentee" choice for: the one in the link (/p/1600's Sign up), else the site's featured program.
  const linked = typeof sp.program === "string" ? sp.program : null;
  const slug = linked ?? env.FEATURED_PROGRAM_SLUG ?? null;
  const program = slug ? await publicProgram(slug) : null;
  return <SignupForm googleEnabled={googleAuthEnabled} next={next} program={program ? { id: program.id, name: program.name } : null} menteeFirst={Boolean(linked && program)} />;
}
