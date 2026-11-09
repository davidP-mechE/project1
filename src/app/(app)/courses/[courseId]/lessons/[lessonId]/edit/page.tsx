import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonEditor } from "@/components/lesson/lesson-editor";
import { Alert } from "@/components/ui/alert";
import { NotFoundError } from "@/server/courses";
import { getLessonView } from "@/server/generation/lessons";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Edit lesson" };

export default async function EditLessonPage({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]/edit">) {
  const user = await requireUser();
  const { courseId, lessonId } = await params;
  let view;
  try {
    view = await getLessonView(user.id, courseId, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const back = `/courses/${courseId}/lessons/${lessonId}`;
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href={back} className="hover:text-text hover:underline">
          ← Back to lesson
        </Link>
      </nav>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Edit: {view.lesson.title}</h1>
      <p className="mb-8 text-sm text-muted">
        Your changes are kept even if you regenerate the rest of the course. Page numbers must be within{" "}
        {view.lesson.pageStart === view.lesson.pageEnd ? `page ${view.lesson.pageStart}` : `pages ${view.lesson.pageStart}–${view.lesson.pageEnd}`}.
      </p>
      {!view.content || ["QUEUED", "GENERATING"].includes(view.lesson.status) ? (
        <Alert tone="info">This lesson can be edited once it has been written.</Alert>
      ) : (
        <LessonEditor
          courseId={courseId}
          lessonId={lessonId}
          pageStart={view.lesson.pageStart}
          initial={{
            content: view.content,
            questions: view.questions.map((q) => ({
              type: q.type,
              prompt: q.prompt,
              choices: q.choices,
              correctChoice: q.correctChoice,
              answer: q.answer,
              explanation: q.explanation,
              steps: q.steps,
              pageRefs: q.pageRefs,
              topic: q.topic,
            })),
            flashcards: view.flashcards.map((f) => ({ front: f.front, back: f.back, pageRefs: f.pageRefs })),
          }}
        />
      )}
    </div>
  );
}
