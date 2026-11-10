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
import { getExternalAssignment } from "@/server/external";
import { ExternalSet } from "@/components/classes/external-forms";
import { diagnosticState } from "@/server/diagnostics";
import { DiagnosticTaker, type DiagnosticView } from "@/components/sat/diagnostic-taker";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Assignment" };

/** A question set from a class. (A lessons assignment opens the student's copy of the course instead.) */
export default async function AssignmentPage({ params }: PageProps<"/classes/assignments/[assignmentId]">) {
  const user = await requireUser();
  const { assignmentId } = await params;
  const diag = await diagnosticState(user.id, assignmentId).catch((err) => {
    if (err instanceof NotFoundError) return null;
    throw err;
  });
  if (diag) {
    // Dates go to the client component as strings.
    const view = JSON.parse(JSON.stringify(diag)) as DiagnosticView;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-sm">
          <Link href="/classes" className="text-muted hover:text-text hover:underline">
            ← {diag.className}
          </Link>
        </p>
        <PageHeader title={diag.title} description={diag.closesAt ? `Closes ${dueText(diag.closesAt)}` : "Diagnostic"} />
        <DiagnosticTaker view={view} desmosKey={env.DESMOS_API_KEY ?? null} />
      </div>
    );
  }
  const ext = await getExternalAssignment(user.id, assignmentId).catch((err) => {
    if (err instanceof NotFoundError) return null;
    throw err;
  });
  if (ext) {
    const done = ext.items.filter((i) => i.result).length;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-sm">
          <Link href="/classes" className="text-muted hover:text-text hover:underline">
            ← {ext.assignment.className}
          </Link>
        </p>
        <PageHeader title={ext.assignment.title} description={`${ext.items.length} College Board questions · ${done} recorded · ${dueText(ext.assignment.dueAt)}`} />
        {ext.assignment.note && <Alert tone="info">{ext.assignment.note}</Alert>}
        <p className="text-sm text-muted">These questions are on the College Board&apos;s Question Bank. Open each one, answer it there, then come back and record how it went. Wrong ones go into your mistake log.</p>
        <ExternalSet assignmentId={ext.assignment.id} items={ext.items.map((i) => ({ key: i.key, number: i.number, questionId: i.questionId, url: i.url, domain: i.domain, result: i.result ? { result: i.result.result, reason: i.result.reason } : null }))} />
      </div>
    );
  }
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
