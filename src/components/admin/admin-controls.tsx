"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { demoDataAction, removeAccessRuleAction, retryAssessmentAction, retryBookAction, retryLessonsAction, sendTestEmailAction, setAccessRuleAction, setPlanAction, setRoleAction } from "@/server/actions/admin";
import { inputClasses } from "@/components/ui/field";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const actions = {
  book: retryBookAction,
  lessons: retryLessonsAction,
  assessment: retryAssessmentAction,
} as const;

/** "Retry" for a failed book, a course's failed lessons, or a failed test. */
export function RetryButton({ kind, id, label = "Retry" }: { kind: keyof typeof actions; id: string; label?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await actions[kind](id)))}>
        {pending ? "Retrying…" : label}
      </Button>
      <span role="status" className={result?.ok === false ? "text-xs text-danger" : "text-xs text-muted"}>
        {result ? (result.ok ? result.message : result.error) : ""}
      </span>
    </span>
  );
}

export function PlanSelect({ userId, plan, email }: { userId: string; plan: string; email: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(plan);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={`Plan for ${email}`}
        value={value}
        disabled={pending}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
        onChange={(e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          setError(null);
          start(async () => {
            const r = await setPlanAction(userId, next);
            if (!r.ok) {
              setValue(before);
              setError(r.error);
            }
          });
        }}
      >
        <option value="FREE">Free</option>
        <option value="PRO">Pro</option>
      </select>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/** Load / Clear buttons for demo mode. */
export function DemoDataControls({ loaded }: { loaded: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const go = (op: "load" | "clear") => start(async () => setResult(await demoDataAction(op)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => go("load")}>
        {pending ? "Working…" : loaded ? "Reload demo data" : "Load demo data"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !loaded}
        onClick={() => {
          if (confirm("Delete every demo account, the demo class and all their work? Real data isn't touched.")) go("clear");
        }}
      >
        Clear demo data
      </Button>
      <span role="status" className={result?.ok === false ? "text-xs text-danger" : "text-xs text-muted"}>
        {result ? (result.ok ? result.message : result.error) : ""}
      </span>
    </div>
  );
}

/** Owner only: student, approved tutor (writes bank questions and shared tests), or site admin. */
export function RoleSelect({ userId, role, email }: { userId: string; role: string; email: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);
  if (role === "OWNER") return <span className="text-xs font-semibold">Owner</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={`Role for ${email}`}
        value={value}
        disabled={pending}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
        onChange={(e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          setError(null);
          start(async () => {
            const r = await setRoleAction(userId, next);
            if (!r.ok) {
              setValue(before);
              setError(r.error);
            }
          });
        }}
      >
        <option value="USER">Student</option>
        <option value="TUTOR">Tutor</option>
        <option value="ADMIN">Site admin</option>
      </select>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/** Admin → Program access: limit an email to one program, or block it from one. */
export function AccessRuleForm({ programs }: { programs: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        start(async () => {
          const r = await setAccessRuleAction({ email: String(f.get("email") ?? ""), programId: String(f.get("programId") ?? ""), mode: String(f.get("mode") ?? ""), note: String(f.get("note") ?? "") || undefined });
          setResult(r);
          if (r.ok) form.reset();
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input name="email" type="email" required maxLength={254} placeholder="student@example.com" className={inputClasses} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Program
        <select name="programId" required className={inputClasses}>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Rule
        <select name="mode" required className={inputClasses} defaultValue="ONLY">
          <option value="ONLY">Only this program</option>
          <option value="BLOCKED">Blocked from this program</option>
        </select>
      </label>
      <Button type="submit" disabled={pending || programs.length === 0}>
        {pending ? "Saving…" : "Save rule"}
      </Button>
      <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2 lg:col-span-4">
        Note (optional, only admins see it)
        <input name="note" maxLength={200} placeholder="Why, for the other admins" className={inputClasses} />
      </label>
      <p role="status" className={`text-sm sm:col-span-2 lg:col-span-4 ${result?.ok === false ? "text-danger" : "text-muted"}`}>
        {result ? (result.ok ? result.message : result.error) : ""}
      </p>
    </form>
  );
}

export function RemoveRuleButton({ id, email }: { id: string; email: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await removeAccessRuleAction(id); if (!r.ok) setError(r.error); })}>
        {pending ? "Removing…" : "Remove"}
        <span className="sr-only"> the rule for {email}</span>
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Admin → Email: send yourself a test email. */
export function TestEmailButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await sendTestEmailAction()))}>
        {pending ? "Sending…" : "Send me a test email"}
      </Button>
      <span role="status" className={result?.ok === false ? "text-sm text-danger" : "text-sm text-muted"}>
        {result ? (result.ok ? result.message : result.error) : ""}
      </span>
    </span>
  );
}
