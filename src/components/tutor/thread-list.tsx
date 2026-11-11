"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteThreadAction } from "@/server/actions/tutor";
import { cn } from "@/lib/utils";

type Thread = { id: string; title: string; lessonTitle: string | null };

/** Past conversations with the tutor (the left column of the Tutor page). */
export function ThreadList({ courseId, threads, current }: { courseId: string; threads: Thread[]; current: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const list = (
    <ul className="flex flex-col gap-0.5">
      {threads.map((t) => (
        <li key={t.id} className="group flex items-center gap-1">
          <Link
            href={`/courses/${courseId}/tutor?thread=${t.id}`}
            aria-current={t.id === current ? "page" : undefined}
            className={cn("press-soft min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm", t.id === current ? "bg-primary/10 font-medium" : "text-muted hover:bg-surface-2 hover:text-text")}
          >
            <span className="block truncate">{t.title}</span>
            {t.lessonTitle && <span className="block truncate text-xs font-normal text-muted">{t.lessonTitle}</span>}
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              confirm("Delete this conversation?") &&
              startTransition(async () => {
                const res = await deleteThreadAction(courseId, t.id);
                if (res.ok && t.id === current) router.push(`/courses/${courseId}/tutor`);
                else router.refresh();
              })
            }
            className="press rounded-md px-1.5 py-1 text-xs text-muted opacity-100 hover:bg-surface-2 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
            aria-label={`Delete conversation "${t.title}"`}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <nav aria-label="Conversations" className="sticky top-22 hidden max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto lg:flex">
        <Link href={`/courses/${courseId}/tutor`} className="press rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm font-medium hover:bg-surface-2">
          + New conversation
        </Link>
        {threads.length > 0 ? list : <p className="px-2 text-xs text-muted">Your conversations will appear here.</p>}
      </nav>
      {threads.length > 0 && (
        <details className="rounded-xl border border-border bg-surface lg:hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Past conversations ({threads.length})</summary>
          <div className="flex flex-col gap-2 border-t border-border p-2">
            <Link href={`/courses/${courseId}/tutor`} className="px-2 py-1 text-sm font-medium text-primary">
              + New conversation
            </Link>
            {list}
          </div>
        </details>
      )}
    </>
  );
}
