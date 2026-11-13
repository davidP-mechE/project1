"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createAssessmentsAction, regenerateAssessmentAction } from "@/server/actions/assessments";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { NoAiNote, useNoAi } from "@/components/ai-access";

/** Refreshes the page every few seconds while a test is being written. */
export function AssessmentPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <Spinner /> Claude is writing this from your lessons…
    </span>
  );
}

export function RegenerateButton({ courseId, assessmentId, label = "Write new questions" }: { courseId: string; assessmentId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (useNoAi()) return null; // writing questions uses AI ("SAT only, no AI" accounts)
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await regenerateAssessmentAction(courseId, assessmentId);
            if (!res.ok) setError(res.error ?? "Failed.");
            else router.refresh();
          })
        }
      >
        {label}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

export function CreateAssessmentsButton({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (useNoAi()) return <NoAiNote>Writing unit tests uses AI, which isn&apos;t available on your account.</NoAiNote>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await createAssessmentsAction(courseId);
            if (!res.ok) setMsg(res.error ?? "Failed.");
            else {
              setMsg(res.queued ? null : "Nothing to write yet: unit tests are written once all of a unit's lessons are finished.");
              router.refresh();
            }
          })
        }
      >
        Write unit tests & final exam
      </Button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
