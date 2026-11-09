"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { regenerateLessonAction } from "@/server/actions/generation";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { DotsIcon, Menu } from "@/components/ui/menu";

/** Polls a lesson that's being written and refreshes the page when its status changes. */
export function LessonStatusPoller({ courseId, lessonId, status }: { courseId: string; lessonId: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "QUEUED" && status !== "GENERATING") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/lessons/${lessonId}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const next = await res.json();
        if (next.status !== status) router.refresh();
      } catch {
        /* try again */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [courseId, lessonId, status, router]);
  return null;
}

type Props = { courseId: string; lessonId: string; status: string; hasContent: boolean; userEdited: boolean };

/** Regenerate / Edit actions for a lesson. */
export function LessonActions({ courseId, lessonId, status, hasContent, userEdited }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useRef<HTMLDialogElement>(null);
  const busy = status === "QUEUED" || status === "GENERATING";

  const run = (mode: "lesson" | "questions", allowThin = false) =>
    startTransition(async () => {
      setError(null);
      const res = await regenerateLessonAction(courseId, lessonId, mode, allowThin);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {hasContent && (
          <Link href={`/courses/${courseId}/lessons/${lessonId}/edit`} className={buttonClasses("secondary", "sm")} aria-disabled={busy}>
            Edit
          </Link>
        )}
        <Menu
          label="Lesson actions"
          items={[
            { label: hasContent ? "Regenerate this lesson" : "Generate this lesson", onSelect: () => (userEdited ? confirm.current?.showModal() : run("lesson")), disabled: busy || pending },
            { label: "New practice questions", onSelect: () => run("questions"), disabled: busy || pending || !hasContent },
          ]}
        >
          <DotsIcon />
        </Menu>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <dialog ref={confirm} aria-labelledby="regen-title" className="m-auto w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/50">
        <h2 id="regen-title" className="text-lg font-semibold">
          Replace your edits?
        </h2>
        <p className="mt-2 text-sm text-muted">You edited this lesson by hand. Regenerating will replace the lesson, its questions and its flashcards.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => confirm.current?.close()}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              confirm.current?.close();
              run("lesson");
            }}
          >
            Regenerate
          </Button>
        </div>
      </dialog>
    </div>
  );
}

/** Buttons shown on a flagged or failed lesson. */
export function LessonRecovery({ courseId, lessonId, kind }: { courseId: string; lessonId: string; kind: "flagged" | "failed" | "pending" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (allowThin: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await regenerateLessonAction(courseId, lessonId, "lesson", allowThin);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {kind === "flagged" && (
          <Button onClick={() => run(true)} disabled={pending}>
            {pending ? "Starting…" : "Try anyway"}
          </Button>
        )}
        {kind === "failed" && (
          <Button onClick={() => run(false)} disabled={pending}>
            {pending ? "Starting…" : "Try again"}
          </Button>
        )}
        {kind === "pending" && (
          <Button onClick={() => run(false)} disabled={pending}>
            {pending ? "Starting…" : "Generate this lesson"}
          </Button>
        )}
        <Link href={`/courses/${courseId}/outline`} className={buttonClasses("secondary")}>
          Edit outline
        </Link>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
