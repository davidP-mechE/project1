"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { retryAssessmentAction, retryBookAction, retryLessonsAction, setPlanAction } from "@/server/actions/admin";

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
