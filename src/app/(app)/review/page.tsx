import type { Metadata } from "next";
import Link from "next/link";
import { ReviewSession } from "@/components/review/review-session";
import { StudyTimer } from "@/components/study/study-timer";
import { PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/session";
import { getReviewCounts, getReviewQueue } from "@/server/srs";
import { getDueQuestions } from "@/server/review";
import { buttonClasses } from "@/components/ui/button";
import { QUESTION_INTERVALS } from "@/lib/mastery/review";

export const metadata: Metadata = { title: "Spaced repetition" };

/**
 * Spaced repetition: practice questions that are due again (a miss comes back
 * tomorrow, right answers further out each time), and today's flashcards,
 * across all courses or one course with ?course=…
 */
export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const user = await requireUser();
  const sp = await searchParams;
  const counts = await getReviewCounts(user.id);
  const courseId = typeof sp.course === "string" && counts.courses.some((c) => c.courseId === sp.course) ? sp.course : undefined;
  const [queue, questions] = await Promise.all([getReviewQueue(user.id, { courseId }), getDueQuestions(user.id, { limit: 0 })]);
  const course = counts.courses.find((c) => c.courseId === courseId);

  return (
    <div className="mx-auto max-w-2xl">
      <StudyTimer />
      <PageHeader
        title={course ? `Spaced repetition: ${course.title}` : "Spaced repetition"}
        description="Things come back just before you're likely to forget them: questions you've answered, and your flashcards."
      />
      <section aria-labelledby="due-questions" className="lift mb-8 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="due-questions" className="text-xl font-semibold">
            Questions due
          </h2>
          <span className="text-sm text-muted">{questions.total === 0 ? "None right now" : `${questions.total} across ${questions.courses.length} ${questions.courses.length === 1 ? "course" : "courses"}`}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          A question you miss comes back the next day; each time you get it right, it waits longer ({QUESTION_INTERVALS.slice(0, 5).join(", ")}… days).
        </p>
        {questions.courses.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {questions.courses.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{c.title}</span>
                  <span className="text-sm text-muted">
                    {c.due} {c.due === 1 ? "question" : "questions"} due
                  </span>
                </span>
                <Link href={`/review/questions?course=${c.id}`} className={buttonClasses("primary", "sm", "shrink-0")}>
                  Start<span className="sr-only"> {c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <h2 className="mb-1 text-xl font-semibold">Flashcards</h2>
      <p className="mb-4 text-sm text-muted">
        {queue.dueCount} due · {queue.newCount} new today
      </p>
      {counts.courses.length > 1 && (
        <nav aria-label="Choose a course" className="mb-6 flex flex-wrap gap-2 text-sm">
          <Link href="/review" aria-current={!courseId ? "page" : undefined} className={cn("rounded border px-3 py-1", !courseId ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-surface-2")}>
            All courses <span className="text-muted">({counts.due + counts.new})</span>
          </Link>
          {counts.courses.map((c) => (
            <Link
              key={c.courseId}
              href={`/review?course=${c.courseId}`}
              aria-current={c.courseId === courseId ? "page" : undefined}
              className={cn("rounded border px-3 py-1", c.courseId === courseId ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-surface-2")}
            >
              {c.title} <span className="text-muted">({c.due + c.new})</span>
            </Link>
          ))}
        </nav>
      )}
      <ReviewSession key={courseId ?? "all"} items={queue.items} backHref={courseId ? `/courses/${courseId}/flashcards` : "/library"} />
    </div>
  );
}
