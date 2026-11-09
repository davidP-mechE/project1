"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { retryProcessingAction } from "@/server/actions/courses";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export type ProcessingStatusData = {
  courseStatus: string;
  bookStatus: string;
  bookError: string | null;
  pageCount: number | null;
  job: { status: string; step: string | null; progress: number; message: string | null; error: string | null } | null;
};

const STEPS = [
  { key: "open", label: "Open the PDF" },
  { key: "text", label: "Read the text on every page" },
  { key: "ocr", label: "Scan pages that are pictures (OCR)" },
  { key: "figures", label: "Save figures" },
  { key: "cover", label: "Make a cover" },
  { key: "outline", label: "Build the outline" },
  { key: "chunks", label: "Prepare text for search" },
];

/** Shows live progress while the worker processes the book; refreshes the page when it's done. */
export function ProcessingStatus({ courseId, initial }: { courseId: string; initial: ProcessingStatusData }) {
  const router = useRouter();
  const [status, setStatus] = useState<ProcessingStatusData>(initial);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const processing = status.courseStatus === "PROCESSING";

  useEffect(() => {
    if (!processing) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/processing`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next: ProcessingStatusData = await res.json();
        if (stopped) return;
        setStatus(next);
        if (next.courseStatus !== "PROCESSING") router.refresh(); // show the outline or the error
      } catch {
        /* network blip: try again on the next tick */
      }
    };
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [processing, courseId, router]);

  const job = status.job;
  const currentIndex = STEPS.findIndex((s) => s.key === job?.step);
  const queued = !job || job.status === "QUEUED";

  if (status.courseStatus === "FAILED") {
    const error = job?.error ?? status.bookError ?? "Something went wrong while reading this PDF.";
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">{error}</Alert>
        {retryError && <Alert tone="error">{retryError}</Alert>}
        <div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setRetryError(null);
                const res = await retryProcessingAction(courseId);
                if (!res.ok) {
                  setRetryError(res.error);
                } else {
                  setStatus((s) => ({ ...s, courseStatus: "PROCESSING", job: null }));
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Restarting…" : "Try again"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="flex flex-col gap-2">
        <ProgressBar value={job?.progress ?? 0} label="Processing progress" />
        <p className="text-sm">
          {queued && !job?.message?.startsWith("Hit a problem")
            ? "Waiting for a free worker… This usually starts within a few seconds."
            : (job?.message ?? "Working…")}
        </p>
      </div>
      <ol className="flex flex-col gap-1.5 text-sm">
        {STEPS.map((s, i) => {
          const done = job?.step === "done" || currentIndex > i;
          const active = currentIndex === i;
          return (
            <li
              key={s.key}
              className={cn("flex items-center gap-2", done || active ? "text-text" : "text-muted", active && "font-medium")}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-xs",
                  done ? "bg-success-bg text-success" : active ? "bg-primary text-primary-text" : "bg-surface-2",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span>
                {s.label}
                <span className="sr-only">{done ? " (done)" : active ? " (in progress)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">
        You can leave this page. Processing keeps going in the background. A 300-page book usually takes a few minutes;
        scanned books take longer.
      </p>
    </div>
  );
}
