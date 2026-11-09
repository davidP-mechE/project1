"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function VerifyEmail({ email: initialEmail, expired }: { email?: string; expired: boolean }) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/library" });
    setStatus(error ? "error" : "sent");
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{expired ? "That link has expired" : "Check your email"}</h1>
      <p className="mt-2 text-sm text-muted">
        {expired
          ? "Verification links work for 1 hour. Send yourself a new one below."
          : <>We sent a verification link to {initialEmail ? <strong className="text-text">{initialEmail}</strong> : "your email"}. Click it to activate your account.</>}
      </p>
      <form onSubmit={resend} className="mt-6 flex flex-col gap-4">
        {status === "sent" && <Alert tone="success">If that address has an account waiting for verification, a new link is on its way.</Alert>}
        {status === "error" && <Alert tone="error">We couldn&apos;t send the email. Please wait a few minutes and try again.</Alert>}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <Button type="submit" variant="secondary" disabled={status === "sending" || !email}>
          {status === "sending" ? "Sending…" : "Resend verification email"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted"><Link href="/login" className="text-primary underline-offset-2 hover:underline">Back to log in</Link></p>
    </>
  );
}
