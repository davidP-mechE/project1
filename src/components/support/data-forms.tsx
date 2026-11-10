"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { deleteAccountAction, purgeStudentAction, resolveProblemAction } from "@/server/actions/support";

/** Program admin: delete everything the program holds about one student (type their name to confirm). */
export function PurgeStudentForm({ programId, studentId, name }: { programId: string; studentId: string; name: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await purgeStudentAction(programId, studentId, confirm);
          if (!r.ok) return setError(r.error);
          router.push("/teach");
        });
      }}
    >
      <Field label={`Type "${name}" to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="danger" disabled={pending || confirm.trim() !== name.trim()}>
          Delete this student&apos;s program data
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm(`Permanently delete ${email} and all their data? This can't be undone.`)) return;
        start(async () => {
          const r = await deleteAccountAction(email, confirm);
          setMsg(r.ok ? { tone: "success", text: "Deleted." } : { tone: "error", text: r.error });
          if (r.ok) {
            setEmail("");
            setConfirm("");
          }
        });
      }}
    >
      <Field label="Account email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field label="Type it again" type="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {msg && <Alert tone={msg.tone} className="sm:col-span-2">{msg.text}</Alert>}
      <div className="sm:col-span-2">
        <Button type="submit" variant="danger" disabled={pending || !email || email !== confirm}>
          Delete the account and all its data
        </Button>
      </div>
    </form>
  );
}

export function ResolveButton({ kind, id }: { kind: "error" | "report"; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await resolveProblemAction(kind, id); router.refresh(); })}>
      Mark fixed
    </Button>
  );
}
