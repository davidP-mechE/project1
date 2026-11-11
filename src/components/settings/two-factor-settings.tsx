"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";

type Setup = { uri: string; qr: string; secret: string; backupCodes: string[] };

/**
 * Two-factor login with an authenticator app (Google Authenticator, Authy,
 * 1Password…). Required for program admins and staff; optional for students.
 */
export function TwoFactorSettings({ enabled, required, hasPassword }: { enabled: boolean; required: boolean; hasPassword: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password, issuer: "Coursebook" });
    setBusy(false);
    if (error || !data || !("totpURI" in data) || !data.totpURI) return setError(error?.status === 400 ? "That password isn't right." : "Couldn't start setup. Please try again.");
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ uri: data.totpURI, qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }), secret, backupCodes: data.backupCodes ?? [] });
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error) return setError("That code didn't work. Check the time on your phone is right, and try the newest code.");
    setCodes(setup!.backupCodes);
    setSetup(null);
    router.refresh();
  }

  async function turnOff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) return setError("That password isn't right.");
    router.refresh();
  }

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <div id="two-factor">
        <h2 className="text-lg font-semibold">Two-factor login</h2>
        <p className="text-sm text-muted">
          {enabled ? "On: logging in asks for a code from your authenticator app." : "Adds a 6-digit code from an authenticator app (such as Google Authenticator or Authy) when you log in."}
        </p>
      </div>
      {required && !enabled && <Alert tone="warning">You&apos;re on a tutoring program&apos;s staff, so two-factor login is required before you can see student data. Turn it on below.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {codes && (
        <Alert tone="success">
          <p className="font-medium">Two-factor login is on. Save these backup codes somewhere safe; each one works once if you lose your phone:</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!hasPassword && !enabled ? (
        <p className="text-sm text-muted">Set a password first (under Account below), then turn on two-factor login.</p>
      ) : enabled ? (
        !required && (
          <form onSubmit={turnOff} className="flex flex-wrap items-end gap-3">
            <Field label="Password" name="password" type="password" autoComplete="current-password" required className="min-w-56 flex-1" />
            <Button type="submit" variant="secondary" disabled={busy}>
              Turn off
            </Button>
          </form>
        )
      ) : setup ? (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>In your authenticator app, add an account and scan this code.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code to add Coursebook to your authenticator app" width={200} height={200} className="rounded-lg border border-border bg-white" />
          <p className="text-xs text-muted">
            Can&apos;t scan? Enter this key instead: <code className="break-all font-mono">{setup.secret}</code>
          </p>
          <Field label="Then enter the 6-digit code it shows" name="code" inputMode="numeric" autoComplete="one-time-code" required />
          <div>
            <Button type="submit" disabled={busy}>
              Turn on two-factor login
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={start} className="flex flex-wrap items-end gap-3">
          <Field label="Confirm your password" name="password" type="password" autoComplete="current-password" required className="min-w-56 flex-1" />
          <Button type="submit" disabled={busy}>
            Set up
          </Button>
        </form>
      )}
    </Card>
  );
}
