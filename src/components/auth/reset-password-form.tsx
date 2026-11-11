"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <>
        <h1 className="font-display text-3xl">Link expired</h1>
        <p className="mt-2 text-sm text-muted">This password reset link is invalid or has expired.</p>
        <p className="mt-6"><Link href="/forgot-password" className="text-primary underline-offset-2 hover:underline">Request a new link</Link></p>
      </>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setBusy(false);
    if (error) {
      setError("This reset link is invalid or has expired. Please request a new one.");
      return;
    }
    router.push("/login?notice=password-reset");
  }

  return (
    <>
      <h1 className="font-display text-3xl">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} hint="At least 8 characters." />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
      </form>
    </>
  );
}
