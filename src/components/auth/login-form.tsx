"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { GoogleButton, OrDivider } from "./google-button";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo";

/** `next`: where to go after logging in (a path on this site, e.g. a class invite link). */
export function LoginForm({ googleEnabled, notice, next = "/library", demo = false }: { googleEnabled: boolean; notice?: string; next?: string; demo?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await logIn(String(form.get("email")), String(form.get("password")));
  }

  async function logIn(email: string, password: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    const { data, error } = await authClient.signIn.email({ email, password, callbackURL: next });
    setBusy(false);
    if (error) {
      if (error.status === 403) {
        setInfo("Please verify your email first. We just sent you a new verification link.");
      } else if (error.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
      } else {
        setError("That email and password don't match. Check them and try again.");
      }
      return;
    }
    // Two-factor accounts confirm a code from their authenticator app next.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push(`/login/two-factor?next=${encodeURIComponent(next)}`);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Log in</h1>
      <p className="mt-1 text-sm text-muted">
        New here? <Link href={next === "/library" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} className="font-medium text-primary underline-offset-2 hover:underline">Create an account</Link>
      </p>
      {googleEnabled && (
        <>
          <div className="mt-6"><GoogleButton /></div>
          <OrDivider />
        </>
      )}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate={false}>
        {error && <Alert tone="error">{error}</Alert>}
        {info && <Alert tone="info">{info}</Alert>}
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-sm text-primary underline-offset-2 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
      </form>
      {demo && (
        <section aria-labelledby="demo-logins" className="mt-6 rounded-xl border border-dashed border-border p-4">
          <h2 id="demo-logins" className="text-sm font-semibold">Try the demo</h2>
          <p className="mt-1 text-xs text-muted">A made-up program with invented students. Log in as:</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <Button key={a.email} type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void logIn(a.email, DEMO_PASSWORD)}>
                {a.role}
              </Button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
