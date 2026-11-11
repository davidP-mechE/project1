"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/** Enter the 6-digit code from an authenticator app, or a backup code. */
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const trustDevice = new FormData(e.currentTarget).get("trust") === "on";
    setBusy(true);
    setError(null);
    const { error } = backup ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice }) : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? "Too many tries. Please wait a few minutes." : error.status === 401 && /session|expired/i.test(error.message ?? "") ? "That took too long. Log in again." : "That code didn't work. Check it and try again.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Two-factor code</h1>
      <p className="mt-1 text-sm text-muted">{backup ? "Enter one of the backup codes you saved when you turned on two-factor login. Each works once." : "Open your authenticator app and enter the 6-digit code for Coursebook."}</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field key={backup ? "b" : "t"} label={backup ? "Backup code" : "6-digit code"} name="code" autoComplete="one-time-code" inputMode={backup ? "text" : "numeric"} required autoFocus />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="trust" className="size-4 accent-[var(--primary)]" />
          Trust this device for 30 days
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setBackup(!backup)}>
          {backup ? "Use my authenticator app" : "Use a backup code"}
        </button>
        {" · "}
        <Link href="/login" className="text-muted hover:underline">
          Back to log in
        </Link>
      </p>
    </>
  );
}
