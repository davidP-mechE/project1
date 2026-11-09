import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceKindProvider } from "@/components/course/source-kind";
import { PracticeSession } from "@/components/study/practice-session";
import { StudyTimer } from "@/components/study/study-timer";
import { EmptyState } from "@/components/ui/misc";
import { getCourseOr404 } from "@/server/course-page";
import { claudeEnabled, env } from "@/server/env";
import { getDueQuestions } from "@/server/review";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Questions due" };

/** A session of the questions due again in one course (spaced repetition). */
export default async function DueQuestionsPage({ searchParams }: PageProps<"/review/questions">) {
  const user = await requireUser();
  const courseId = (await searchParams).course;
  if (typeof courseId !== "string" || courseId.length > 64) notFound();
  const course = await getCourseOr404(user.id, courseId);
  const due = await getDueQuestions(user.id, { courseId, limit: 20 });
  const grading = env.FAKE_CLAUDE ? "demo" : claudeEnabled ? "claude" : null;
  return (
    <SourceKindProvider kind={course.book.kind}>
      <div className="mx-auto max-w-2xl">
        <StudyTimer />
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
          <Link href="/review" className="hover:text-text hover:underline">
            Spaced repetition
          </Link>
          <span aria-hidden> › </span>
          <span>{course.title}</span>
        </nav>
        <h1 className="sr-only">Questions due: {course.title}</h1>
        {due.items.length === 0 ? (
          <EmptyState title="Nothing due here">Questions come back here when it&apos;s time to review them again.</EmptyState>
        ) : (
          <PracticeSession courseId={courseId} bookId={course.book.id} items={due.items} grading={grading} lessonTitle={null} title="Questions due" doneHref="/review" doneLabel="Back to spaced repetition" />
        )}
      </div>
    </SourceKindProvider>
  );
}
