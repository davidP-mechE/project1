"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { archiveCourseAction, deleteCourseAction, renameCourseAction } from "@/server/actions/courses";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/misc";
import { CourseCover } from "./cover";

export type CourseCardData = {
  id: string;
  title: string;
  status: string;
  progressPct: number;
  lastOpenedAt: string | null;
  lastOpenedLabel: string;
  archived: boolean;
  coverUrl: string | null;
};

const statusLabels: Record<string, string> = {
  UPLOADING: "Upload not finished",
  PROCESSING: "Processing…",
  OUTLINE_DRAFT: "Review outline",
  GENERATING: "Generating lessons…",
  FAILED: "Failed",
};

export function CourseCard({ course }: { course: CourseCardData }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });

  const status = statusLabels[course.status];

  return (
    <li className="flex gap-4 rounded-xl border border-border bg-surface p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0 sm:flex-col sm:gap-0" aria-busy={pending}>
      <Link href={`/courses/${course.id}`} className="press-soft block w-20 shrink-0 sm:w-full" tabIndex={-1} aria-hidden>
        <CourseCover title={course.title} coverUrl={course.coverUrl} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:mt-3">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title"));
              act(async () => {
                const res = await renameCourseAction(course.id, title);
                if (res.ok) setEditing(false);
                return res;
              });
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor={`title-${course.id}`} className="sr-only">Course title</label>
            <input id={`title-${course.id}`} name="title" defaultValue={course.title} maxLength={200} className={inputClasses} autoFocus required />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <h2 className="line-clamp-2 font-semibold leading-snug">
            <Link href={`/courses/${course.id}`} className="hover:underline">{course.title}</Link>
          </h2>
        )}
        {status ? (
          <p className={course.status === "FAILED" ? "text-sm text-danger" : "text-sm text-muted"}>{status}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <ProgressBar value={course.progressPct} label={`${course.title} progress`} />
            <p className="text-xs text-muted">{course.progressPct}% complete</p>
          </div>
        )}
        <p className="text-xs text-muted">
          {course.lastOpenedAt ? (
            <time dateTime={course.lastOpenedAt}>Opened {course.lastOpenedLabel}</time>
          ) : (
            "Not opened yet"
          )}
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="-ml-2 mt-auto flex flex-wrap gap-1 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>Rename</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => archiveCourseAction(course.id, !course.archived))}>
            {course.archived ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => dialogRef.current?.showModal()}>
            Delete
          </Button>
        </div>
      </div>
      <dialog ref={dialogRef} className="m-auto max-w-sm rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/50" aria-labelledby={`del-${course.id}`}>
        <h3 id={`del-${course.id}`} className="text-lg font-semibold">Delete this course?</h3>
        <p className="mt-2 text-sm text-muted">
          &ldquo;{course.title}&rdquo;, its uploaded PDF, and all lessons, notes and progress will be permanently deleted. This can&apos;t be undone.
        </p>
        <form method="dialog" className="mt-6 flex justify-end gap-2">
          <Button type="submit" variant="secondary">Cancel</Button>
          <Button variant="danger" onClick={() => { dialogRef.current?.close(); act(() => deleteCourseAction(course.id)); }}>
            Delete forever
          </Button>
        </form>
      </dialog>
    </li>
  );
}
