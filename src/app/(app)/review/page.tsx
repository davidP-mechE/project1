import type { Metadata } from "next";
import Link from "next/link";
import { ReviewSession } from "@/components/review/review-session";
import { PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/session";
import { getReviewCounts, getReviewQueue } from "@/server/srs";

export const metadata: Metadata = { title: "Review" };

/** Today's flashcards across all courses, or one course with ?course=… */
export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const user = await requireUser();
  const sp = await searchParams;
  const counts = await getReviewCounts(user.id);
  const courseId = typeof sp.course === "string" && counts.courses.some((c) => c.courseId === sp.course) ? sp.course : undefined;
  const queue = await getReviewQueue(user.id, { courseId });
  const course = counts.courses.find((c) => c.courseId === courseId);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={course ? `Review: ${course.title}` : "Review"}
        description={`${queue.dueCount} due · ${queue.newCount} new today. Spaced repetition shows each card just before you're likely to forget it.`}
      />
      {counts.courses.length > 1 && (
        <nav aria-label="Choose a course" className="mb-6 flex flex-wrap gap-2 text-sm">
          <Link href="/review" aria-current={!courseId ? "page" : undefined} className={cn("rounded-full border px-3 py-1", !courseId ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-surface-2")}>
            All courses <span className="text-muted">({counts.due + counts.new})</span>
          </Link>
          {counts.courses.map((c) => (
            <Link
              key={c.courseId}
              href={`/review?course=${c.courseId}`}
              aria-current={c.courseId === courseId ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1", c.courseId === courseId ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-surface-2")}
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
