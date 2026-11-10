import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { QuestionSet } from "@/components/classes/question-set";
import { dueText } from "@/components/classes/format";
import { NotFoundError } from "@/server/courses";
import { ClassError, getQuestionAssignment, startLessons } from "@/server/classes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Assignment" };

/** A question set from a class. (A lessons assignment opens the student's copy of the course instead.) */
export default async function AssignmentPage({ params }: PageProps<"/classes/assignments/[assignmentId]">) {
  const user = await requireUser();
  const { assignmentId } = await params;
  let data;
  try {
    data = await getQuestionAssignment(user.id, assignmentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ClassError) {
      // A lessons assignment: open the course at the next lesson.
      const r = await startLessons(user.id, assignmentId).catch(() => null);
      if (r) redirect(r.lessonId ? `/courses/${r.courseId}/lessons/${r.lessonId}` : `/courses/${r.courseId}`);
      notFound();
    }
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/classes" className="text-muted hover:text-text hover:underline">
          ← {data.className}
        </Link>
      </p>
      <PageHeader title={data.title} description={`${data.questions.length} questions · ${dueText(data.dueAt)}${data.course ? ` · ${data.course.title}` : ""}`} />
      {data.note && <Alert tone="info">{data.note}</Alert>}
      <QuestionSet
        data={{
          id: data.id,
          title: data.title,
          timeLimitMin: data.timeLimitMin,
          started: data.started,
          endsAt: data.endsAt?.toISOString() ?? null,
          handedIn: data.handedIn,
          reveal: data.reveal,
          questions: data.questions,
        }}
      />
    </div>
  );
}
