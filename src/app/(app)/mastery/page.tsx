import type { Metadata } from "next";
import Link from "next/link";
import { SubjectSelect } from "@/components/review/subject-select";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader, ProgressBar } from "@/components/ui/misc";
import { getSubjectMastery } from "@/server/subjects";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Mastery" };

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

/** Mastery by subject (Mathematics, Physics, English & writing…), across all the student's courses. */
export default async function MasteryPage() {
  const user = await requireUser();
  const { subjects, courseCount } = await getSubjectMastery(user.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader title="Mastery" description="How well you know each subject, from your practice answers and flashcard memory across all your courses in it." />
      {courseCount === 0 ? (
        <EmptyState title="Nothing to measure yet" action={<Link href="/library" className={buttonClasses("primary")}>Go to your library</Link>}>
          Generate a course and answer some practice questions. Your subjects will show up here.
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <li key={s.id}>
                <a href={`#subject-${s.id}`} className="press-soft lift flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-5 hover:bg-surface-2">
                  <span className="flex items-center gap-3">
                    <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-primary text-xl text-primary-text">
                      {s.icon}
                    </span>
                    <span>
                      <span className="block font-display text-lg font-semibold">{s.name}</span>
                      <span className="text-xs text-muted">
                        {s.courses.length} {s.courses.length === 1 ? "course" : "courses"}
                      </span>
                    </span>
                  </span>
                  <span className="text-3xl font-bold tabular-nums">{pct(s.mastery)}</span>
                  <ProgressBar value={s.mastery * 100} label={`${s.name} mastery`} />
                  <span className="text-xs text-muted">
                    Accuracy (30 days): {pct(s.accuracy)} · {s.skills.hammered} of {s.skills.total} skills hammered
                  </span>
                </a>
              </li>
            ))}
          </ul>

          {subjects.map((s) => (
            <section key={s.id} id={`subject-${s.id}`} aria-labelledby={`h-${s.id}`} className="scroll-mt-6">
              <h2 id={`h-${s.id}`} className="mb-3 text-xl font-semibold">
                <span aria-hidden>{s.icon} </span>
                {s.name}
              </h2>
              <ul className="flex flex-col gap-3">
                {s.courses.map((c) => (
                  <li key={c.id} className="lift flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/courses/${c.id}/practice`} className="font-semibold hover:underline">
                          {c.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {c.lessons.mastered} mastered · {c.lessons.familiar} familiar · {c.lessons.learning} learning · {c.lessons.new} new lessons
                        </p>
                      </div>
                      <SubjectSelect courseId={c.id} subject={c.subject} title={c.title} />
                    </div>
                    <div className="flex items-center gap-3">
                      <ProgressBar value={c.mastery * 100} label={`${c.title} mastery`} />
                      <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{pct(c.mastery)}</span>
                    </div>
                    {c.weakest.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted">Shaky skills:</span>
                        {c.weakest.map((w) => (
                          <Link key={w.key} href={`/skills/drill?course=${c.id}&skill=${encodeURIComponent(w.key)}`} className="press rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-semibold text-danger hover:underline">
                            {w.topic} · {pct(w.accuracy)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
