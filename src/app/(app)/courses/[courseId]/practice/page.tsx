import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseHeader } from "@/components/course/course-header";
import { MasteryBadge } from "@/components/study/mastery";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { LEVEL_LABEL, type MasteryLevel } from "@/lib/mastery/mastery";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { getCourseMastery } from "@/server/mastery";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Practice" };

const LEVELS: MasteryLevel[] = ["mastered", "familiar", "learning", "new"];

export default async function PracticePage({ params }: PageProps<"/courses/[courseId]/practice">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  let m;
  try {
    m = await getCourseMastery(user.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const lessons = m.units.flatMap((u) => u.lessons);
  const pct = Math.round(m.overall.score * 100);

  return (
    <div className="mx-auto max-w-4xl">
      <CourseHeader course={course} />
      {m.questionCount === 0 ? (
        <EmptyState title="Nothing to practise yet">Practice questions are written with each lesson. Generate lessons to start practising.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="practice-hero" className="hero-card stagger flex flex-col gap-5 rounded-3xl p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium opacity-80">Mastery practice</p>
              <h2 id="practice-hero" className="font-display text-3xl font-semibold">
                {pct}% mastered
              </h2>
              <p className="max-w-md text-sm opacity-85">
                Each set has 10 questions, picked from what you know least. Get one wrong and it comes back a little later, until you get it right.
              </p>
            </div>
            <ButtonLink href={`/courses/${courseId}/practice/session`} className="hero-button self-start sm:self-center">
              Start a practice set
            </ButtonLink>
          </section>

          <Card className="stagger">
            <h2 className="sr-only">Lessons by level</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {LEVELS.map((l) => (
                <div key={l} className="rounded-xl bg-surface-2 px-3 py-3">
                  <dd className="text-2xl font-semibold tabular-nums">{m.overall.counts[l]}</dd>
                  <dt className="mt-1">
                    <MasteryBadge level={l} />
                  </dt>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={LEVELS.map((l) => `${m.overall.counts[l]} ${LEVEL_LABEL[l].toLowerCase()}`).join(", ")}>
              {LEVELS.map((l) =>
                m.overall.counts[l] ? (
                  <span key={l} className={l === "mastered" ? "bg-success" : l === "familiar" ? "bg-primary" : l === "learning" ? "bg-warning" : "bg-transparent"} style={{ width: `${(m.overall.counts[l] / lessons.length) * 100}%` }} />
                ) : null,
              )}
            </div>
          </Card>

          {m.units.map((u) => (
            <section key={u.id} aria-labelledby={`unit-${u.id}`} className="stagger">
              <h2 id={`unit-${u.id}`} className="mb-2 font-display text-lg font-semibold">
                {u.title}
              </h2>
              <ul className="flex flex-col gap-2">
                {u.lessons.map((l) => (
                  <li key={l.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/courses/${courseId}/lessons/${l.id}`} className="font-medium hover:underline">
                        {l.title}
                      </Link>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <MasteryBadge level={l.mastery.level} />
                        <span>
                          {l.mastery.answered} of {l.mastery.questions} questions answered · {Math.round(l.mastery.score * 100)}%
                        </span>
                      </p>
                    </div>
                    {l.mastery.questions > 0 && (
                      <Link href={`/courses/${courseId}/practice/session?lesson=${l.id}`} className={buttonClasses("secondary", "sm", "shrink-0 self-start sm:self-center")}>
                        Practise<span className="sr-only"> {l.title}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
