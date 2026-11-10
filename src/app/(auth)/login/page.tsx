import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { googleAuthEnabled } from "@/server/env";
import { getSession } from "@/server/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Log in" };

const notices: Record<string, string> = {
  "password-reset": "Your password was changed. Log in with your new password.",
  "account-deleted": "Your account and all of its data have been deleted.",
  "email-changed": "Your email was changed. Please log in again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { notice, error, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  if (await getSession()) redirect(next);
  const message =
    typeof notice === "string"
      ? notices[notice]
      : typeof error === "string"
        ? "Sign-in with Google didn't work. Please try again or use email and password."
        : undefined;
  return <LoginForm googleEnabled={googleAuthEnabled} notice={message} next={next} />;
}
