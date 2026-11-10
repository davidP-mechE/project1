"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { GoogleButton, OrDivider } from "./google-button";

export function SignupForm({ googleEnabled, next = "/library" }: { googleEnabled: boolean; next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const email = String(form.get("email")).trim();
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email,
      password,
      callbackURL: next, // where the verification link lands (e.g. back to a class invite)
    });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : (error.message ?? "We couldn't create your account. Please try again."),
      );
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted">
        Already have one? <Link href={next === "/library" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="font-medium text-primary underline-offset-2 hover:underline">Log in</Link>
      </p>
      {googleEnabled && (
        <>
          <div className="mt-6"><GoogleButton /></div>
          <OrDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name" name="name" autoComplete="name" required maxLength={100} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} hint="At least 8 characters." />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        <p className="text-xs text-muted">
          By signing up you agree to the <Link href="/terms" className="underline">Terms</Link> and{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
        <Button type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</Button>
      </form>
    </>
  );
}
