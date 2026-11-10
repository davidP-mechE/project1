"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";

type Msg = { tone: "success" | "error"; text: string } | null;

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function ChangeName({ name }: { name: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Name" description="Shown to your tutors, classmates' tutors and in messages.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const next = String(new FormData(e.currentTarget).get("name")).trim();
          if (!next) return setMsg({ tone: "error", text: "Enter your name." });
          setBusy(true);
          const { error } = await authClient.updateUser({ name: next.slice(0, 80) });
          setBusy(false);
          setMsg(error ? { tone: "error", text: error.message ?? "Couldn't change your name." } : { tone: "success", text: "Saved." });
          if (!error) router.refresh();
        }}
      >
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Your name" name="name" defaultValue={name} required maxLength={80} autoComplete="name" />
        <div><Button type="submit" variant="secondary" disabled={busy}>{busy ? "Saving…" : "Save name"}</Button></div>
      </form>
    </Section>
  );
}

function ChangeEmail({ email }: { email: string }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Email address" description={`Currently ${email}.`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const newEmail = String(new FormData(form).get("email")).trim();
          setBusy(true);
          const { error } = await authClient.changeEmail({ newEmail, callbackURL: "/settings?notice=email-verified" });
          setBusy(false);
          if (error) {
            setMsg({ tone: "error", text: error.message ?? "Couldn't change your email." });
          } else {
            form.reset();
            setMsg({ tone: "success", text: `Check ${email} for a link to approve the change. After that, we'll send a verification link to ${newEmail}.` });
          }
        }}
      >
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="New email" name="email" type="email" required autoComplete="email" />
        <div><Button type="submit" variant="secondary" disabled={busy}>{busy ? "Sending…" : "Change email"}</Button></div>
      </form>
    </Section>
  );
}

function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  if (!hasPassword) {
    return (
      <Section title="Password">
        <p className="text-sm text-muted">
          You sign in with Google, so there&apos;s no password on this account. To add one, log out and use{" "}
          <a href="/forgot-password" className="underline">Forgot password</a> with your email.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Password" description="Changing your password logs you out on your other devices.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          const newPassword = String(data.get("new"));
          if (newPassword !== String(data.get("confirm"))) {
            setMsg({ tone: "error", text: "The new passwords don't match." });
            return;
          }
          setBusy(true);
          const { error } = await authClient.changePassword({
            currentPassword: String(data.get("current")),
            newPassword,
            revokeOtherSessions: true,
          });
          setBusy(false);
          if (error) {
            setMsg({ tone: "error", text: error.status === 400 ? "Your current password is incorrect." : (error.message ?? "Couldn't change your password.") });
          } else {
            form.reset();
            setMsg({ tone: "success", text: "Password changed." });
          }
        }}
      >
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
        <Field label="New password" name="new" type="password" required minLength={8} maxLength={128} autoComplete="new-password" hint="At least 8 characters." />
        <Field label="Confirm new password" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        <div><Button type="submit" variant="secondary" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button></div>
      </form>
    </Section>
  );
}

function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Delete account" description="Permanently delete your account, every uploaded book, all courses, notes and progress. This can't be undone.">
      <Button variant="danger" onClick={() => { setError(null); dialogRef.current?.showModal(); }}>Delete my account</Button>
      <dialog ref={dialogRef} aria-labelledby="delete-account-title" className="m-auto w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/50">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            if (String(data.get("confirm")).trim().toUpperCase() !== "DELETE") {
              setError('Type DELETE to confirm.');
              return;
            }
            setBusy(true);
            const { error } = await authClient.deleteUser(
              hasPassword ? { password: String(data.get("password")) } : {},
            );
            setBusy(false);
            if (error) {
              setError(
                hasPassword
                  ? "That password is incorrect."
                  : "For your security, please log out and log back in, then try again within 10 minutes.",
              );
              return;
            }
            router.push("/login?notice=account-deleted");
            router.refresh();
          }}
        >
          <h3 id="delete-account-title" className="text-lg font-semibold">Delete your account?</h3>
          {error && <Alert tone="error">{error}</Alert>}
          {hasPassword && <Field label="Your password" name="password" type="password" required autoComplete="current-password" />}
          <Field label='Type "DELETE" to confirm' name="confirm" required autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={busy}>{busy ? "Deleting…" : "Delete forever"}</Button>
          </div>
        </form>
      </dialog>
    </Section>
  );
}

export function AccountSettings({ name, email, hasPassword, notice }: { name: string; email: string; hasPassword: boolean; notice?: string }) {
  return (
    <div className="flex flex-col gap-6">
      {notice && <Alert tone="success">{notice}</Alert>}
      <ChangeName name={name} />
      <ChangeEmail email={email} />
      <ChangePassword hasPassword={hasPassword} />
      <DeleteAccount hasPassword={hasPassword} />
    </div>
  );
}
