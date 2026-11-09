import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseHeader } from "@/components/course/course-header";
import { FlashcardBrowser } from "@/components/review/flashcard-browser";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { requireUser } from "@/server/session";
import { getCourseFlashcards, getReviewCounts } from "@/server/srs";

export const metadata: Metadata = { title: "Flashcards" };

export default async function FlashcardsPage({ params }: PageProps<"/courses/[courseId]/flashcards">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  let data;
  try {
    data = await getCourseFlashcards(user.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const counts = (await getReviewCounts(user.id)).courses.find((c) => c.courseId === courseId);
  const total = data.lessons.reduce((n, l) => n + l.cards.length, 0);
  const now = new Date();

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />
      {total === 0 ? (
        <EmptyState title="No flashcards yet">Flashcards are written with each lesson. Generate lessons to get them.</EmptyState>
      ) : (
        <>
          <Card className="mb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Study this course&apos;s cards</h2>
                <p className="mt-1 text-sm text-muted">
                  {counts ? `${counts.due} due · ${counts.new} new today` : "Nothing due"}. {total} cards in total. New cards come from lessons you&apos;ve opened.
                </p>
              </div>
              <ButtonLink href={`/review?course=${courseId}`} className="shrink-0">
                Review now
              </ButtonLink>
            </div>
          </Card>
          <FlashcardBrowser courseId={courseId} bookId={data.bookId} lessons={data.lessons.map((l) => ({ ...l, cards: l.cards.map((c) => ({ ...c, dueLabel: dueLabel(c.state, c.due, now) })) }))} />
        </>
      )}
    </div>
  );
}

function dueLabel(state: string, due: Date | null, now: Date): string {
  if (state === "NEW" || !due) return "New";
  const days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  if (due <= now) return "Due now";
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return days < 60 ? `Due in ${days} days` : `Due in ${Math.round(days / 30)} months`;
}
