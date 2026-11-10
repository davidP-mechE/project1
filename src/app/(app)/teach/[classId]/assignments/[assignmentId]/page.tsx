import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Markdown } from "@/components/lesson/markdown";
import { Card, PageHeader, ProgressBar } from "@/components/ui/misc";
import { DeleteAssignmentButton, DueDateForm } from "@/components/classes/teacher-forms";
import { dueText, pct, STATUS_LABEL } from "@/components/classes/format";
import { cn } from "@/lib/utils";
import { RegradeButton } from "@/components/classes/regrade-button";
import { domainName } from "@/lib/sat/domains";
import { NotFoundError } from "@/server/courses";
import { assignmentReport } from "@/server/classes";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Assignment report" };

const letter = (i: number) => String.fromCharCode(65 + i);

/** One assignment: every student's result; for question sets, how the class did on each question and what each student answered. */
export default async function AssignmentReportPage({ params }: PageProps<"/teach/[classId]/assignments/[assignmentId]">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { classId, assignmentId } = await params;
  let r;
  try {
    r = await assignmentReport(user.id, assignmentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const a = r.assignment;
  if (a.classId !== classId) notFound();
  const names = new Map(r.students.map((s) => [s.student.id, s.student.name || s.student.email]));
  if (a.kind === "DIAGNOSTIC") redirect(`/teach/${a.classId}/diagnostics/${a.id}`);
  const questions = a.kind === "QUESTIONS";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/${classId}`} className="text-muted hover:text-text hover:underline">
          ← {a.class.name}
        </Link>
      </p>
      <PageHeader
        title={a.title}
        description={[
          questions ? `${a.itemIds.length} questions from ${a.worksheet?.title ?? "a worksheet"}` : `${a.lessonIds.length || "All"} lessons from ${a.classCourse?.title ?? "a course"}`,
          a.timeLimitMin ? `timed, ${a.timeLimitMin} min` : null,
          dueText(a.dueAt, undefined, zone),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={<DeleteAssignmentButton classId={classId} assignmentId={a.id} />}
      />
      <Card className="flex flex-col gap-4">
        <DueDateForm classId={classId} assignmentId={a.id} dueAt={a.dueAt?.toISOString() ?? null} />
        {a.note && <p className="text-sm text-muted">Note to students: {a.note}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Students</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Student
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {questions ? "Answered" : "Lessons done"}
                </th>
                {questions && (
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Score
                  </th>
                )}
                <th scope="col" className="py-2 font-medium">
                  Last active
                </th>
              </tr>
            </thead>
            <tbody>
              {r.students.length === 0 && (
                <tr>
                  <td colSpan={20} className="py-6 text-center text-sm text-muted">
                    No students to show yet: nobody it&apos;s assigned to has joined, or they&apos;re outside your groups.
                  </td>
                </tr>
              )}
              {r.students.map((s) => (
                <tr key={s.student.id} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {s.student.name || s.student.email}
                  </th>
                  <td className={cn("py-2 pr-4", s.status === "done" ? "text-success" : s.late ? "text-danger" : "text-muted")}>
                    {STATUS_LABEL[s.status]}
                    {s.late ? (s.status === "done" ? " (late)" : " (overdue)") : ""}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {s.done}/{s.total || "?"}
                  </td>
                  {questions && <td className="py-2 pr-4 tabular-nums">{pct(s.score)}</td>}
                  <td className="py-2 text-muted">{s.lastActive ? formatInZone(s.lastActive, zone, "day") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {r.external.length > 0 && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">College Board questions</h2>
          <p className="mb-4 text-sm text-muted">Students answer these on the College Board site and record how they did.</p>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {r.external.map((q) => (
              <li key={q.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <a href={q.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                    {q.questionId}
                    <span className="sr-only"> (opens College Board in a new tab)</span>
                  </a>{" "}
                  <span className="text-muted">· {domainName(q.domain)}</span>
                </span>
                <span className="tabular-nums text-muted">
                  {q.correct} right · {q.incorrect} wrong · {q.skipped} skipped
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}


      {questions && (
        <section aria-labelledby="by-question" className="flex flex-col gap-4">
          <h2 id="by-question" className="text-lg font-semibold">
            By question
          </h2>
          {r.questions.map((q) => (
            <Card key={q.id} className="flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                <span>
                  #{q.label} · {q.topic}
                  {q.answerSource === "CLAUDE" && <span className="ml-2 rounded bg-warning-bg px-1.5 py-0.5 font-medium text-warning">Answer worked out by Claude: check it</span>}
                </span>
                <span className="tabular-nums">
                  {q.answered} answered · {pct(q.correctRate)} correct
                </span>
              </div>
              {q.olderAnswers > 0 && r.access.role !== "VIEWER" && <RegradeButton assignmentId={r.assignment.id} itemId={q.id} classId={r.assignment.classId} count={q.olderAnswers} version={q.version} />}
              <ProgressBar value={(q.correctRate ?? 0) * 100} label={`Question ${q.label}: ${pct(q.correctRate)} correct`} className="h-1.5" />
              <Markdown>{q.prompt}</Markdown>
              {q.choices.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {q.choices.map((c, k) => (
                    <li key={k} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5", k === q.correctChoice ? "border-success bg-success-bg" : "border-border")}>
                      <span className="font-semibold text-muted">{letter(k)}.</span>
                      <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                      <span className="text-xs tabular-nums text-muted">
                        {q.choiceCounts[k]} {q.choiceCounts[k] === 1 ? "student" : "students"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm">
                  <span className="font-medium">Answer:</span> {q.answer}
                </p>
              )}
              {q.answers.length > 0 && (
                <details className="rounded-lg bg-surface-2 p-3 text-sm">
                  <summary className="font-medium">Each student&apos;s answer</summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {q.answers.map((x) => (
                      <li key={x.studentId}>
                        <span className="font-medium">{names.get(x.studentId)}</span>{" "}
                        <span className={x.correct ? "text-success" : "text-danger"}>{x.correct ? "✓" : "✗"}</span>{" "}
                        {x.choice !== null ? `${letter(x.choice)}. ${q.choices[x.choice] ?? ""}` : x.response}
                        {x.feedback && !x.correct && <span className="block text-xs text-muted">{x.feedback}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
