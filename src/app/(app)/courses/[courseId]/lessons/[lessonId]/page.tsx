import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonActions, LessonRecovery, LessonStatusPoller } from "@/components/lesson/lesson-actions";
import { Flashcards, KeyTerms, Objectives, PageRefs, Questions, Section, WorkedExamples } from "@/components/lesson/lesson-parts";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Card, Spinner } from "@/components/ui/misc";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError, markCourseOpened } from "@/server/courses";
import { getLessonView } from "@/server/generation/lessons";
import { requireUser } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]">): Promise<Metadata> {
  const user = await requireUser();
  const { courseId, lessonId } = await params;
  try {
    const v = await getLessonView(user.id, courseId, lessonId);
    return { title: v.lesson.title };
  } catch {
    return { title: "Lesson" };
  }
}

export default async function LessonPage({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]">) {
  const user = await requireUser();
  const { courseId, lessonId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  let view;
  try {
    view = await getLessonView(user.id, courseId, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  await markCourseOpened(user.id, courseId);
  const { lesson, content, questions, flashcards } = view;
  const bookId = course.book.id;
  const busy = lesson.status === "QUEUED" || lesson.status === "GENERATING";
  const pages = lesson.pageStart === lesson.pageEnd ? `p. ${lesson.pageStart}` : `pp. ${lesson.pageStart}–${lesson.pageEnd}`;

  return (
    <article className="mx-auto max-w-3xl">
      <LessonStatusPoller courseId={courseId} lessonId={lessonId} status={lesson.status} />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href={`/courses/${courseId}`} className="hover:text-text hover:underline">
          {course.title}
        </Link>
        <span aria-hidden> › </span>
        <span>{view.unit.title}</span>
      </nav>

      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{lesson.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {view.position && `Lesson ${view.position.index} of ${view.position.total} · `}
            <a href={`/api/books/${bookId}/file#page=${lesson.pageStart}`} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">
              Book {pages}
            </a>
            {lesson.userEdited && " · Edited by you"}
          </p>
        </div>
        <LessonActions courseId={courseId} lessonId={lessonId} status={lesson.status} hasContent={Boolean(content)} userEdited={lesson.userEdited} />
      </header>

      {busy && (
        <Alert tone="info" className="mb-6">
          <span className="flex items-center gap-2">
            <Spinner />
            {content
              ? "This lesson is being rewritten. The current version stays here until the new one is ready."
              : lesson.status === "QUEUED"
                ? "This lesson is waiting its turn to be written…"
                : "Claude is writing this lesson from the book… This usually takes under a minute."}
          </span>
        </Alert>
      )}
      {lesson.error && !busy && (
        <Alert tone="error" className="mb-6">
          {lesson.error}
        </Alert>
      )}

      {!content && !busy && (
        <Card>
          {lesson.status === "FLAGGED" ? (
            <>
              <h2 className="text-lg font-semibold">This lesson needs your attention</h2>
              <p className="mt-2 text-sm">{lesson.flagReason}</p>
              <p className="mt-2 text-sm text-muted">
                Rather than guess, Coursebook didn&apos;t write this lesson. You can fix the page range in the outline, or try
                anyway; the lesson will only use what&apos;s on the pages.
              </p>
              <div className="mt-4">
                <LessonRecovery courseId={courseId} lessonId={lessonId} kind="flagged" />
              </div>
            </>
          ) : lesson.status === "FAILED" ? (
            <>
              <h2 className="text-lg font-semibold">This lesson couldn&apos;t be written</h2>
              <div className="mt-4">
                <LessonRecovery courseId={courseId} lessonId={lessonId} kind="failed" />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Not written yet</h2>
              <p className="mt-2 text-sm text-muted">
                {lesson.skip ? "This lesson is skipped in the outline." : "Generate the course, or just this lesson."}
              </p>
              {!lesson.skip && (
                <div className="mt-4">
                  <LessonRecovery courseId={courseId} lessonId={lessonId} kind="pending" />
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {content && (
        <div className="flex flex-col gap-10">
          {content.objectives.length > 0 && (
            <Section title="What you'll learn" id="objectives">
              <Objectives items={content.objectives} />
            </Section>
          )}
          <Section title="Lesson" id="explanation">
            <Markdown>{content.explanation}</Markdown>
          </Section>
          {content.workedExamples.length > 0 && (
            <Section title="Worked examples" id="examples" count={content.workedExamples.length}>
              <WorkedExamples items={content.workedExamples} bookId={bookId} />
            </Section>
          )}
          {content.keyTerms.length > 0 && (
            <Section title="Key terms" id="terms" count={content.keyTerms.length}>
              <KeyTerms items={content.keyTerms} bookId={bookId} />
            </Section>
          )}
          {questions.length > 0 && (
            <Section title="Practice" id="practice" count={questions.length}>
              <Questions items={questions} bookId={bookId} />
            </Section>
          )}
          {flashcards.length > 0 && (
            <Section title="Flashcards" id="flashcards" count={flashcards.length}>
              <Flashcards items={flashcards} />
            </Section>
          )}
          <p className="text-xs text-muted">
            {lesson.model === "demo" ? "Demo lesson (not written by Claude) from" : "Written by Claude from"} {pages} of the book
            {lesson.generatedAt && ` on ${lesson.generatedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}`}. Check
            important details against the original: <PageRefs bookId={bookId} pages={[lesson.pageStart]} />
          </p>
        </div>
      )}

      <nav aria-label="Lessons" className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
        {view.prev ? (
          <Link href={`/courses/${courseId}/lessons/${view.prev.id}`} className="group flex flex-col rounded-lg p-2 hover:bg-surface-2">
            <span className="text-xs text-muted">← Previous</span>
            <span className="font-medium">{view.prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {view.next && (
          <Link href={`/courses/${courseId}/lessons/${view.next.id}`} className="group flex flex-col rounded-lg p-2 text-right hover:bg-surface-2">
            <span className="text-xs text-muted">Next →</span>
            <span className="font-medium">{view.next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
