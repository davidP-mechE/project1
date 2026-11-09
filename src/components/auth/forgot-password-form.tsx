"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const email = String(new FormData(e.currentTarget).get("email"));
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Same message whether or not the account exists, so this page can't be used to find out who has an account.
    setStatus("sent");
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new password.</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {status === "sent" && <Alert tone="success">If an account exists for that email, a reset link is on its way. It expires in 1 hour.</Alert>}
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Button type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send reset link"}</Button>
      </form>
      <p className="mt-6 text-sm text-muted"><Link href="/login" className="text-primary underline-offset-2 hover:underline">Back to log in</Link></p>
    </>
  );
}
