import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { googleAuthEnabled } from "@/server/env";
import { getSession } from "@/server/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return <SignupForm googleEnabled={googleAuthEnabled} next={next} />;
}
