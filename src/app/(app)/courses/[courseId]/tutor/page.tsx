import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseHeader } from "@/components/course/course-header";
import { StudyShell } from "@/components/study/study-shell";
import { ThreadList } from "@/components/tutor/thread-list";
import { TutorChat, type ChatMessage } from "@/components/tutor/tutor-chat";
import { StudyTimer } from "@/components/study/study-timer";
import { Alert } from "@/components/ui/alert";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { claudeEnabled } from "@/server/env";
import { requireUser } from "@/server/session";
import { isNoAi, NO_AI_MESSAGE } from "@/server/program-access";
import { EmptyState } from "@/components/ui/misc";
import { getThread, listThreads, tutorStatus, type Source } from "@/server/tutor/chat";

export const metadata: Metadata = { title: "Ask the book" };

export default async function TutorPage({ params, searchParams }: PageProps<"/courses/[courseId]/tutor">) {
  const user = await requireUser();
  const { courseId } = await params;
  const sp = await searchParams;
  const course = await getCourseOr404(user.id, courseId);
  // "SAT only, no AI" accounts: the tutor uses AI, so say so plainly instead.
  if (await isNoAi(user.id)) {
    return (
      <>
        <CourseHeader course={course} />
        <EmptyState title="The tutor isn't available on your account">{NO_AI_MESSAGE}</EmptyState>
      </>
    );
  }
  const [threads, status] = await Promise.all([listThreads(user.id, courseId), tutorStatus(user.id, courseId)]);
  const threadId = typeof sp.thread === "string" ? sp.thread : null;
  let thread = null;
  if (threadId) {
    try {
      thread = await getThread(user.id, threadId);
    } catch (err) {
      if (err instanceof NotFoundError) notFound();
      throw err;
    }
    if (thread.courseId !== courseId) notFound();
  }
  const initial: ChatMessage[] = (thread?.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    status: m.status,
    sources: (m.sources as Source[] | null) ?? [],
    citedPages: m.citedPages,
    notInBook: m.notInBook,
    error: m.error,
  }));
  const disabledReason = !status.ready ? "The tutor will be ready when the book has been processed." : !claudeEnabled ? "The tutor needs an ANTHROPIC_API_KEY on the server." : null;

  return (
    <div>
      <StudyTimer />
      <div className="mx-auto max-w-3xl">
        <CourseHeader course={course} />
      </div>
      <StudyShell bookId={course.book.id} sidebar={<ThreadList courseId={courseId} threads={threads.map((t) => ({ id: t.id, title: t.title, lessonTitle: t.lesson?.title ?? null }))} current={thread?.id ?? null} />}>
        <div className="flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col">
          {status.ready && status.meaningSearch < 1 && (
            <Alert tone="info" className="mb-3">
              Still preparing the book for the tutor ({Math.round(status.meaningSearch * 100)}%). Until it&apos;s done, answers rely on matching words, so rephrasing can help.
            </Alert>
          )}
          {thread?.lesson && <p className="mb-2 text-xs text-muted">About the lesson “{thread.lesson.title}”: its pages are preferred.</p>}
          <TutorChat
            key={thread?.id ?? "new"}
            courseId={courseId}
            bookId={course.book.id}
            threadId={thread?.id ?? null}
            lessonId={thread?.lessonId ?? null}
            lessonTitle={thread?.lesson?.title ?? null}
            initial={initial}
            syncUrl
            disabledReason={disabledReason}
            className="flex-1"
          />
        </div>
      </StudyShell>
    </div>
  );
}
