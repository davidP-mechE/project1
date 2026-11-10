"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startLessonsAction } from "@/server/actions/classes";

/** Opens an assigned course: makes the student's copy the first time (a few seconds), then goes to the next lesson. */
export function StartLessonsButton({ assignmentId, started, variant = "primary" }: { assignmentId: string; started: boolean; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await startLessonsAction(assignmentId);
            if (!res.ok) return setError(res.error);
            router.push(res.url);
          })
        }
      >
        {pending ? "Opening…" : started ? "Continue" : "Start"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
