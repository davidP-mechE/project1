"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { demoDataAction, retryAssessmentAction, retryBookAction, retryLessonsAction, setPlanAction, setRoleAction } from "@/server/actions/admin";

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
