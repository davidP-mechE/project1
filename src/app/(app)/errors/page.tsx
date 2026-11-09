import type { Metadata } from "next";
import Link from "next/link";
import { PillNav } from "@/components/review/filters";
import { Markdown } from "@/components/lesson/markdown";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { getErrorLog } from "@/server/review";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Error log" };

const STATUSES = [
  { id: "open", label: "Still missing" },
  { id: "fixed", label: "Fixed" },
  { id: "all", label: "All" },
] as const;

const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Every question the student got wrong, by course and skill, with what they answered and the right answer. */
export default async function ErrorLogPage({ searchParams }: PageProps<"/errors">) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s.id === sp.status)?.id ?? "open";
  const everything = await getErrorLog(user.id, { status: "all" });
  const courseId = typeof sp.course === "string" && everything.some((c) => c.id === sp.course) ? sp.course : null;
  const log = await getErrorLog(user.id, { status, courseId });
  const q = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { course: courseId, status, ...over };
    if (merged.course) p.set("course", merged.course);
    if (merged.status && merged.status !== "open") p.set("status", merged.status);
    const s = p.toString();
    return `/errors${s ? `?${s}` : ""}`;
  };
  const totalOpen = everything.reduce((n, c) => n + c.skills.reduce((m, s) => m + s.open, 0), 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Error log"
        description={`Every question you've missed, grouped by course and skill. ${totalOpen ? `${totalOpen} still to fix.` : "Nothing left to fix."} A question counts as fixed once you answer it right.`}
      />
      {everything.length === 0 ? (
        <EmptyState title="No mistakes yet 🌙">Questions you get wrong in lessons, tests, practice and review will be collected here, so you can go back over them.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <PillNav label="Show" items={STATUSES.map((s) => ({ href: q({ status: s.id }), label: s.label, active: s.id === status }))} />
            {everything.length > 1 && (
              <PillNav
                label="Choose a course"
                items={[{ href: q({ course: null }), label: "All courses", active: !courseId }, ...everything.map((c) => ({ href: q({ course: c.id }), label: c.title, count: c.skills.reduce((n, s) => n + s.open, 0), active: c.id === courseId }))]}
              />
            )}
          </div>
          {log.length === 0 && <p className="text-muted">{status === "open" ? "Everything here is fixed. Nice work! 🎉" : "Nothing to show."}</p>}
          {log.map((c) => (
            <section key={c.id} aria-labelledby={`log-${c.id}`} className="flex flex-col gap-4">
              <h2 id={`log-${c.id}`} className="text-xl font-semibold">
                {c.title}
              </h2>
              {c.skills.map((s) => (
                <div key={s.key} className="lift rounded-2xl border border-border bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                    <div>
                      <h3 className="font-semibold">{s.topic}</h3>
                      <p className="text-xs text-muted">
                        {s.entries.length} {s.entries.length === 1 ? "question" : "questions"}
                        {s.open > 0 && ` · ${s.open} still missing`}
                      </p>
                    </div>
                    <Link href={`/skills/drill?course=${c.id}&skill=${encodeURIComponent(s.key)}`} className={buttonClasses("primary", "sm")}>
                      Hammer this skill<span className="sr-only">: {s.topic}</span>
                    </Link>
                  </div>
                  <ul className="divide-y divide-border">
                    {s.entries.map((e) => (
                      <li key={e.questionId}>
                        <details className="group px-5 py-3">
                          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                            <span className="min-w-0">
                              <Markdown className="[&_p]:m-0">{e.prompt}</Markdown>
                              <span className="mt-1 block text-xs text-muted">
                                Missed {e.missed}× · last {date(e.lastMissedAt)} · {e.where}
                              </span>
                            </span>
                            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", e.fixed ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
                              {e.fixed ? "Fixed" : "Missing"}
                            </span>
                          </summary>
                          <div className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-2 p-4 text-sm">
                            <p>
                              <span className="font-semibold">Your answer: </span>
                              {e.yourAnswer}
                            </p>
                            <div>
                              <span className="font-semibold">Right answer: </span>
                              <Markdown className="inline [&_p]:inline">{e.correctAnswer}</Markdown>
                            </div>
                            {e.feedback && e.feedback !== "Not answered." && (
                              <p>
                                <span className="font-semibold">Feedback: </span>
                                {e.feedback}
                              </p>
                            )}
                            {e.explanation && (
                              <div>
                                <span className="font-semibold">Why: </span>
                                <Markdown className="inline [&_p]:inline">{e.explanation}</Markdown>
                              </div>
                            )}
                            {e.lessonId && (
                              <Link href={`/courses/${c.id}/lessons/${e.lessonId}`} className="self-start font-semibold text-accent-ink underline-offset-2 hover:underline">
                                Reread the lesson ›
                              </Link>
                            )}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
