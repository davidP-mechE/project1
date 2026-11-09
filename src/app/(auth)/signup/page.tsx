import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { googleAuthEnabled } from "@/server/env";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage() {
  if (await getSession()) redirect("/library");
  return <SignupForm googleEnabled={googleAuthEnabled} />;
}
