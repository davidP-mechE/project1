"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui/misc";

type Progress = {
  courseStatus: string;
  total: number;
  ready: number;
  flagged: number;
  failed: number;
  done: number;
  current: string | null;
  batch?: { since: string } | null;
};

/** "Writing lesson 14 of 52" while Claude writes the course. Refreshes the page as lessons finish. */
export function GenerationProgress({
  courseId,
  initial,
}: {
  courseId: string;
  initial: Progress;
}) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const running = p.courseStatus === "GENERATING";

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let lastDone = initial.done;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/generation`, {
          cache: "no-store",
        });
        if (!res.ok || stopped) return;
        const next: Progress = await res.json();
        setP(next);
        // Refresh the lesson list when a lesson finishes, so it becomes a link right away.
        if (next.done !== lastDone || next.courseStatus !== "GENERATING") {
          lastDone = next.done;
          router.refresh();
        }
      } catch {
        /* try again next tick */
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, courseId, router, initial.done]);

  if (!running) return null;
  if (p.batch) {
    // Sent as one half-price batch: lessons arrive together, usually within an hour.
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">Writing your course at half price</p>
          <p className="text-sm text-muted">
            {p.ready} of {p.total} ready
          </p>
        </div>
        <ProgressBar
          value={(p.done / Math.max(1, p.total)) * 100}
          label="Lessons written"
        />
        <p className="text-sm text-muted">
          Claude is writing these lessons together as one batch, which costs
          half as much. They usually arrive within an hour (at most a day), all
          at once. You can leave this page; we&apos;ll keep going.
        </p>
      </div>
    );
  }
  const working = Math.min(p.total, p.done + 1);
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          Writing lesson {working} of {p.total}
        </p>
        <p className="text-sm text-muted">{p.ready} ready</p>
      </div>
      <ProgressBar
        value={(p.done / Math.max(1, p.total)) * 100}
        label="Lessons written"
      />
      {p.current && (
        <p className="truncate text-sm text-muted">Now writing: {p.current}</p>
      )}
      <p className="text-xs text-muted">
        Open any lesson marked ready while the rest are written. You can also
        leave this page; generation keeps going.
      </p>
    </div>
  );
}
