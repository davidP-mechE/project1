import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { googleAuthEnabled } from "@/server/env";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Log in" };

const notices: Record<string, string> = {
  "password-reset": "Your password was changed. Log in with your new password.",
  "account-deleted": "Your account and all of its data have been deleted.",
  "email-changed": "Your email was changed. Please log in again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/library");
  const { notice, error } = await searchParams;
  const message =
    typeof notice === "string"
      ? notices[notice]
      : typeof error === "string"
        ? "Sign-in with Google didn't work. Please try again or use email and password."
        : undefined;
  return <LoginForm googleEnabled={googleAuthEnabled} notice={message} />;
}
