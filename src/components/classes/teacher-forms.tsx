"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  cancelInviteAction,
  createClassAction,
  deleteAssignmentAction,
  inviteStudentsAction,
  removeStudentAction,
  updateAssignmentAction,
  updateClassAction,
} from "@/server/actions/classes";

type Msg = { tone: "error" | "success" | "info"; text: string } | null;

export function CreateClassForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createClassAction(name);
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          router.push(`/teach/${res.classId}/students`);
        });
      }}
    >
      <Field label="New class name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SAT Math, Tuesday group" maxLength={120} className="sm:w-80" required />
      <Button type="submit" disabled={pending || !name.trim()}>
        Create class
      </Button>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </form>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}

export function InviteForm({ classId }: { classId: string }) {
  const router = useRouter();
  const [emails, setEmails] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await inviteStudentsAction(classId, emails);
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          const parts = [
            res.invited.length ? `Invited ${res.invited.length}.` : null,
            res.alreadyIn.length ? `${res.alreadyIn.length} already in the class.` : null,
            res.invalid.length ? `Not valid: ${res.invalid.join(", ")}.` : null,
          ].filter(Boolean);
          setMsg({ tone: res.invalid.length ? "info" : "success", text: parts.join(" ") });
          setEmails("");
          router.refresh();
        });
      }}
    >
      <label htmlFor="invite-emails" className="text-sm font-medium">
        Invite by email
      </label>
      <textarea
        id="invite-emails"
        value={emails}
        onChange={(e) => setEmails(e.target.value)}
        rows={3}
        placeholder="One or more email addresses, separated by commas or new lines"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !emails.trim()}>
          Send invitations
        </Button>
        <span className="text-xs text-muted">Each gets a link to join (new students sign up first).</span>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </form>
  );
}

/** Small "Remove" / "Cancel" style buttons that run an action and refresh. */
function ActionButton({ label, confirm, run, variant = "ghost" }: { label: string; confirm?: string; run: () => Promise<{ ok: boolean; error?: string }>; variant?: "ghost" | "secondary" | "danger" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await run();
            if (!res.ok) setError(res.error ?? "Something went wrong.");
            router.refresh();
          });
        }}
      >
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

export const RemoveStudentButton = ({ classId, studentId, name }: { classId: string; studentId: string; name: string }) => (
  <ActionButton label="Remove" confirm={`Remove ${name} from the class? They keep their own copies of courses.`} run={() => removeStudentAction(classId, studentId)} />
);
export const CancelInviteButton = ({ classId, inviteId }: { classId: string; inviteId: string }) => <ActionButton label="Cancel" run={() => cancelInviteAction(classId, inviteId)} />;
export const NewCodeButton = ({ classId }: { classId: string }) => (
  <ActionButton label="New code" variant="secondary" confirm="Make a new class code? The old code and invite links stop working (students already in stay)." run={() => updateClassAction(classId, { newCode: true })} />
);
export const ArchiveClassButton = ({ classId, archived }: { classId: string; archived: boolean }) => (
  <ActionButton
    label={archived ? "Unarchive" : "Archive class"}
    variant="secondary"
    confirm={archived ? undefined : "Archive this class? Students can't join or see it any more; nothing is deleted."}
    run={() => updateClassAction(classId, { archived: !archived })}
  />
);
export const DeleteAssignmentButton = ({ classId, assignmentId }: { classId: string; assignmentId: string }) => (
  <ActionButton label="Delete" variant="danger" confirm="Delete this assignment and students' answers to it? Their course copies stay." run={() => deleteAssignmentAction(classId, assignmentId)} />
);

export function RenameClassForm({ classId, name }: { classId: string; name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateClassAction(classId, { name: value });
          setMsg(res.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: res.error });
          router.refresh();
        });
      }}
    >
      <Field label="Class name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} className="sm:w-80" required />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || value.trim() === name}>
        Rename
      </Button>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </form>
  );
}

/** Change an assignment's due date (local time) or clear it. */
export function DueDateForm({ classId, assignmentId, dueAt }: { classId: string; assignmentId: string; dueAt: string | null }) {
  const router = useRouter();
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  const [value, setValue] = useState(toLocal(dueAt));
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateAssignmentAction(classId, assignmentId, { dueAt: value ? new Date(value).toISOString() : null });
          setSaved(res.ok);
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Due</span>
        <input type="datetime-local" value={value} onChange={(e) => (setValue(e.target.value), setSaved(false))} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {saved ? "Saved" : "Save date"}
      </Button>
    </form>
  );
}
