"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { commentOnAttemptAction } from "@/server/actions/classes";
import { cn } from "@/lib/utils";

export function AttemptCommentForm({ classId, attemptId }: { classId: string; attemptId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await commentOnAttemptAction(classId, attemptId, body);
          if (!r.ok) return setError(r.error);
          setBody("");
          setError(null);
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Add a comment (the student sees it on their log)
        <textarea className={cn(inputClasses, "h-24 py-2")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !body.trim()}>Comment</Button>
      </div>
    </form>
  );
}
