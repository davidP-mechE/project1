import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PracticeSession } from "@/components/study/practice-session";
import { StudyTimer } from "@/components/study/study-timer";
import { EmptyState } from "@/components/ui/misc";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { claudeEnabled, env } from "@/server/env";
import { getPracticeSet } from "@/server/mastery";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Practice set" };

export default async function PracticeSessionPage({ params, searchParams }: PageProps<"/courses/[courseId]/practice/session">) {
  const user = await requireUser();
  const { courseId } = await params;
  const lesson = (await searchParams).lesson;
  const lessonId = typeof lesson === "string" && lesson.length <= 64 ? lesson : null;
  const course = await getCourseOr404(user.id, courseId);
  let set;
  try {
    set = await getPracticeSet(user.id, courseId, { lessonId });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const lessonTitle = lessonId ? (set.questions[0]?.lesson?.title ?? null) : null;
  const grading = env.FAKE_CLAUDE ? "demo" : claudeEnabled ? "claude" : null;

  return (
    <div className="mx-auto max-w-2xl">
      <StudyTimer />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href={`/courses/${courseId}`} className="hover:text-text hover:underline">
          {course.title}
        </Link>
        <span aria-hidden> › </span>
        <Link href={`/courses/${courseId}/practice`} className="hover:text-text hover:underline">
          Practice
        </Link>
      </nav>
      <h1 className="sr-only">{lessonTitle ? `Practice: ${lessonTitle}` : "Practice set"}</h1>
      {set.questions.length === 0 ? (
        <EmptyState title="No questions to practise">Generate lessons first: each one comes with practice questions.</EmptyState>
      ) : (
        <PracticeSession courseId={courseId} bookId={set.bookId} items={set.questions} grading={grading} lessonTitle={lessonTitle} />
      )}
    </div>
  );
}
