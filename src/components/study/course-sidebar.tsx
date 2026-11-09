import Link from "next/link";
import { ProgressBar } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { getStudyOutline } from "@/server/study";

type Outline = Awaited<ReturnType<typeof getStudyOutline>>;

/** Units and lessons with check marks. A sticky column on desktop, a collapsible list on phones. */
export function CourseSidebar({ courseId, courseTitle, outline, currentLessonId }: { courseId: string; courseTitle: string; outline: Outline; currentLessonId: string }) {
  const list = (
    <ol className="flex flex-col gap-4">
      {outline.units.map((u) => (
        <li key={u.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2 px-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{u.title}</h3>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {u.progress.done}/{u.progress.total}
            </span>
          </div>
          <ol className="flex flex-col">
            {u.lessons.map((l) => {
              const current = l.id === currentLessonId;
              return (
                <li key={l.id}>
                  <Link
                    href={`/courses/${courseId}/lessons/${l.id}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "press-soft flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm",
                      current ? "bg-primary/10 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                        l.completed ? "border-success bg-success text-white dark:text-bg" : "border-border",
                      )}
                    >
                      {l.completed ? "✓" : ""}
                    </span>
                    <span className="min-w-0">
                      {l.title}
                      <span className="sr-only">{l.completed ? " (completed)" : l.ready ? "" : " (not written yet)"}</span>
                      {!l.ready && <span className="ml-1 text-xs opacity-70">· not ready</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
  const summary = (
    <div className="flex flex-col gap-1.5">
      <ProgressBar value={outline.pct} label={`${courseTitle} progress`} />
      <p className="text-xs text-muted">
        {outline.done} of {outline.total} lessons complete · {outline.pct}%
      </p>
    </div>
  );
  return (
    <>
      <nav aria-label="Course contents" className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-5.5rem)] flex-col gap-4 overflow-y-auto pb-4 lg:flex">
        <Link href={`/courses/${courseId}`} className="px-2 text-sm font-semibold hover:underline">
          {courseTitle}
        </Link>
        <div className="px-2">{summary}</div>
        {list}
      </nav>
      <details className="rounded-xl border border-border bg-surface lg:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Course contents · {outline.done}/{outline.total} done
        </summary>
        <nav aria-label="Course contents" className="flex flex-col gap-4 border-t border-border p-3">
          {summary}
          {list}
        </nav>
      </details>
    </>
  );
}
