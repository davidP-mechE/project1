"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setLessonCompletedAction, setLessonConfusingAction } from "@/server/actions/study";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { burst } from "@/components/ui/burst";

type Props = { courseId: string; lessonId: string; completed: boolean; confusing: boolean; nextHref: string | null };

/** "Mark as complete", "Complete and continue", and "I found this confusing", at the end of a lesson. */
export function LessonCompletion({ courseId, lessonId, completed, confusing: initialConfusing, nextHref }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confusing, setConfusing] = useState(initialConfusing);

  const setDone = (done: boolean, thenNext = false, from: Element | null = null) =>
    startTransition(async () => {
      setError(null);
      const res = await setLessonCompletedAction(courseId, lessonId, done);
      if (!res.ok) return setError(res.error);
      if (done) burst(from, { count: 26, spread: 120 });
      if (thenNext && nextHref) router.push(nextHref);
      else router.refresh();
    });

  const toggleConfusing = (value: boolean) => {
    setConfusing(value);
    startTransition(async () => {
      const res = await setLessonConfusingAction(lessonId, value);
      if (!res.ok) {
        setConfusing(!value);
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {completed ? (
          <>
            <span className="pop-in inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <span aria-hidden>✓</span> Lesson complete
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDone(false)} disabled={pending}>
              Mark as not done
            </Button>
            {nextHref && (
              <Button size="sm" className="ml-auto" onClick={() => router.push(nextHref)}>
                Next lesson →
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={(e) => setDone(true, false, e.currentTarget)} disabled={pending}>
              Mark as complete
            </Button>
            {nextHref && (
              <Button size="sm" onClick={(e) => setDone(true, true, e.currentTarget)} disabled={pending}>
                Complete and continue →
              </Button>
            )}
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={confusing} onChange={(e) => toggleConfusing(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        I found this lesson confusing (we&apos;ll suggest reviewing it)
      </label>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
