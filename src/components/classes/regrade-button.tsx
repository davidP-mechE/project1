"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { regradeQuestionAction } from "@/server/actions/staff";

/** Answers given before a question was edited keep their grades until a teacher re-grades them. */
export function RegradeButton({ classId, assignmentId, itemId, count, version }: { classId: string; assignmentId: string; itemId: string; count: number; version: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="warning">
        This question was edited (now version {version}). {count} {count === 1 ? "student's answer was" : "students' answers were"} graded against an earlier version and keep that grade unless you re-grade.
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await regradeQuestionAction(classId, assignmentId, itemId);
              if (!res.ok) return setMsg({ tone: "error", text: res.error });
              setMsg({ tone: "info", text: `Re-graded ${res.checked}; ${res.changed} grade${res.changed === 1 ? "" : "s"} changed${res.needsReview ? `, ${res.needsReview} written answer${res.needsReview === 1 ? "" : "s"} left for you to review` : ""}.` });
              router.refresh();
            })
          }
        >
          Re-grade against the current version
        </Button>
        {msg && (
          <span role="status" className={msg.tone === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
