import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import Link from "next/link";
import { BookLoader } from "@/components/ui/book-loader";
import { notFound } from "next/navigation";
import { LessonActions, LessonRecovery, LessonStatusPoller } from "@/components/lesson/lesson-actions";
import { Flashcards, KeyTerms, Objectives, PageRefs, Section, WorkedExamples } from "@/components/lesson/lesson-parts";
import { Markdown } from "@/components/lesson/markdown";
import { SlideDeck } from "@/components/lesson/slide-deck";
import { sanitizeSlideHtml } from "@/lib/slides/sanitize";
import { SLIDE_LESSON_MODEL } from "@/lib/slides/constants";
import { CourseSidebar } from "@/components/study/course-sidebar";
import { LessonCompletion } from "@/components/study/lesson-completion";
import { Practice } from "@/components/study/practice";
import { OpenBookButton, StudyShell } from "@/components/study/study-shell";
import { HighlightProvider, HighlightRoot, LessonNotes } from "@/components/study/highlights";
import { buttonClasses } from "@/components/ui/button";
import { TutorDrawer } from "@/components/tutor/tutor-drawer";
import { StudyTimer } from "@/components/study/study-timer";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/misc";
import { CalculatorPanel } from "@/components/desmos/calculator-panel";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError, markCourseOpened } from "@/server/courses";
import { claudeEnabled, env } from "@/server/env";
import { getLessonView } from "@/server/generation/lessons";
import { requireUser, viewerZone } from "@/server/session";
import { getLatestAttempts, getLessonProgress, getStudyOutline, markLessonViewed } from "@/server/study";
import { getLessonNotes } from "@/server/notes";
import { rangeText, sourceNoun } from "@/lib/source-label";

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

export default async function LessonPage({ params, searchParams }: PageProps<"/courses/[courseId]/lessons/[lessonId]">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { courseId, lessonId } = await params;
  const bookParam = Number((await searchParams).book);
  const initialBookPage = Number.isInteger(bookParam) && bookParam > 0 ? bookParam : null;
  const course = await getCourseOr404(user.id, courseId);
  let view;
  try {
    view = await getLessonView(user.id, courseId, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  await Promise.all([markCourseOpened(user.id, courseId), markLessonViewed(user.id, lessonId)]);
  const [outline, progress, attempts, notes] = await Promise.all([
    getStudyOutline(user.id, courseId),
    getLessonProgress(user.id, lessonId),
    getLatestAttempts(user.id, lessonId),
    getLessonNotes(user.id, lessonId),
  ]);
  const { lesson, content, questions, flashcards } = view;
  const grading = env.FAKE_CLAUDE ? "demo" : claudeEnabled ? "claude" : null;
  const bookId = course.book.id;
  const busy = lesson.status === "QUEUED" || lesson.status === "GENERATING";
  const kind = course.book.kind;
  const slides = kind === "SLIDES";
  const pages = rangeText(kind, lesson.pageStart, lesson.pageEnd);
  // A lesson made from the course's own slides shows them, cleaned again here before they reach the page.
  const deck = content?.slides?.length ? content.slides.map((s) => ({ id: s.id, html: sanitizeSlideHtml(s.html) })) : null;
  const fromSlides = lesson.model === SLIDE_LESSON_MODEL;

  return (
    <StudyShell bookId={bookId} initialPage={initialBookPage} sidebar={<CourseSidebar courseId={courseId} courseTitle={course.title} outline={outline} currentLessonId={lessonId} />}>
    <article>
      <StudyTimer />
      <LessonStatusPoller courseId={courseId} lessonId={lessonId} status={lesson.status} />
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href={`/courses/${courseId}`} className="hover:text-text hover:underline">
          {course.title}
        </Link>
        <span aria-hidden> › </span>
        <span>{view.unit.title}</span>
      </nav>

      <div className="read-progress" aria-hidden />
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl sm:text-[2.4rem]">{lesson.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {view.position && `Lesson ${view.position.index} of ${view.position.total} · `}
            <a href={`/api/books/${bookId}/file#page=${lesson.pageStart}`} data-book-page={lesson.pageStart} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">
              {slides ? "Slides" : "Book"} {pages.replace(/^slides? /, "")}
            </a>
            {progress.completed && " · ✓ Completed"}
            {lesson.userEdited && " · Edited by you"}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <OpenBookButton page={lesson.pageStart} label={slides ? "See the slides" : "Read the book"} />
          {course.subject === "math" && <CalculatorPanel apiKey={env.DESMOS_API_KEY ?? null} storageKey={`lesson-${lessonId}`} />}
          {content && (
            <TutorDrawer
              courseId={courseId}
              bookId={bookId}
              lessonId={lessonId}
              lessonTitle={lesson.title}
              disabledReason={claudeEnabled ? null : "The tutor needs an ANTHROPIC_API_KEY on the server."}
            />
          )}
          <LessonActions courseId={courseId} lessonId={lessonId} status={lesson.status} hasContent={Boolean(content)} userEdited={lesson.userEdited} fromSlides={fromSlides} />
        </div>
      </header>

      {busy && (
        <Alert tone="info" className="mb-6">
          <span className="flex items-center gap-4">
            <BookLoader label="Writing" className="shrink-0 scale-75" />
            {content
              ? "This lesson is being rewritten. The current version stays here until the new one is ready."
              : lesson.status === "QUEUED"
                ? "This lesson is waiting its turn to be written…"
                : `Claude is writing this lesson from the ${sourceNoun(kind)}… This usually takes under a minute.`}
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
        <HighlightProvider lessonId={lessonId} initial={notes.highlights}>
        <div className="flex flex-col gap-10">
          <HighlightRoot>
          <div className="flex flex-col gap-10">
          {content.objectives.length > 0 && (
            <Section title="What you'll learn" id="objectives">
              <Objectives items={content.objectives} />
            </Section>
          )}
          {deck ? (
            <>
              <Section title="Slides" id="slides" count={deck.length}>
                <SlideDeck slides={deck} firstPage={lesson.pageStart} />
              </Section>
              <details className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium">Text version of the slides</summary>
                <div className="mt-3">
                  <Markdown bookId={bookId}>{content.explanation}</Markdown>
                </div>
              </details>
            </>
          ) : (
            <Section title="Lesson" id="explanation">
              <Markdown bookId={bookId}>{content.explanation}</Markdown>
            </Section>
          )}
          {content.workedExamples.length > 0 && (
            <Section title="Worked examples" id="examples" count={content.workedExamples.length}>
              <WorkedExamples items={content.workedExamples} bookId={bookId} kind={kind} />
            </Section>
          )}
          {content.keyTerms.length > 0 && (
            <Section title="Key terms" id="terms" count={content.keyTerms.length}>
              <KeyTerms items={content.keyTerms} bookId={bookId} kind={kind} />
            </Section>
          )}
          </div>
          </HighlightRoot>
          {questions.length > 0 && (
            <Section title="Practice" id="practice" count={questions.length}>
              <Practice items={questions} bookId={bookId} latest={Object.fromEntries(attempts.latest)} grading={grading} />
            </Section>
          )}
          {flashcards.length > 0 && (
            <Section title="Flashcards" id="flashcards" count={flashcards.length}>
              <Flashcards items={flashcards} />
              <a href={`/review?course=${courseId}`} className={buttonClasses("secondary", "sm", "mt-3")}>
                Review flashcards (spaced repetition)
              </a>
            </Section>
          )}
          {fromSlides ? (
          <p className="text-xs text-muted">
            The course&apos;s own lesson slides ({pages}): <PageRefs bookId={bookId} pages={[lesson.pageStart]} kind={kind} />
          </p>
          ) : (
          <p className="text-xs text-muted">
            {lesson.model === "demo" ? "Demo lesson (not written by Claude) from" : "Written by Claude from"} {pages} of the {sourceNoun(kind)}
            {lesson.generatedAt && ` on ${formatInZone(lesson.generatedAt, zone, "medium")}`}. Check
            important details against the original: <PageRefs bookId={bookId} pages={[lesson.pageStart]} kind={kind} />
          </p>
          )}
          <LessonNotes courseId={courseId} initialNote={notes.note} />
          {!lesson.skip && (
            <LessonCompletion
              key={`${lessonId}-${progress.completed}`}
              courseId={courseId}
              lessonId={lessonId}
              completed={progress.completed}
              confusing={progress.confusing}
              nextHref={view.next ? `/courses/${courseId}/lessons/${view.next.id}` : null}
            />
          )}
        </div>
        </HighlightProvider>
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
    </StudyShell>
  );
}
