import { myAttendance } from "@/server/cohort";
import { publishedPlan } from "@/server/curriculum";
import { classLessons } from "@/server/assistant";
import { BaselineBanner } from "@/components/scores/baseline-banner";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { JoinCodeForm, LeaveClassButton } from "@/components/classes/join-forms";
import { StartLessonsButton } from "@/components/classes/start-lessons-button";
import { dueText, pct, STATUS_LABEL } from "@/components/classes/format";
import { cn } from "@/lib/utils";
import { myClasses } from "@/server/classes";
import { requireUser, viewerZone } from "@/server/session";
import { ProgramTag } from "@/components/brand/seal";

export const metadata: Metadata = { title: "Classes" };

/** The student's classes: join one with a code; see what's assigned, when it's due, and how they did. */
export default async function ClassesPage() {
  const user = await requireUser();
  const zone = await viewerZone();
  const [classes, attendance] = await Promise.all([myClasses(user.id), myAttendance(user.id)]);
  const extras = new Map(
    await Promise.all(
      classes.map(async (c) => [c.id, { plan: await publishedPlan(user.id, c.id).catch(() => null), lessons: (await classLessons(user.id, c.id).catch(() => ({ lessons: [] }))).lessons }] as const),
    ),
  );
  const now = new Date();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <BaselineBanner userId={user.id} />
      <PageHeader
        eyebrow="Your classes"
        title="Classes"
        description="Work your teachers assign, with due dates. Your progress on it is shared with them."
        actions={
          <Link href="/teach" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
            Teaching a class? Set it up →
          </Link>
        }
      />
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Join a class</h2>
          <p className="text-sm text-muted">Enter the code your tutor gave you, or open their invite link.</p>
        </div>
        <div className="sm:min-w-[24rem]">
          <JoinCodeForm />
        </div>
      </Card>
      {classes.length === 0 ? (
        <EmptyState title="No classes yet">Ask your teacher for the class code or an invite link.</EmptyState>
      ) : (
        classes.map((c, ci) => (
          <Card key={c.id} className="relative overflow-hidden p-0">
            <span aria-hidden className="absolute inset-y-0 left-0 w-2" style={{ background: ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)"][ci % 5] }} />
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-surface-2/50 px-6 py-5 pl-8">
              <div>
                <ProgramTag program={c.program} className="mb-1" />
                <h2 className="font-display text-2xl font-semibold">{c.name}</h2>
                {c.teacherName && <p className="text-sm text-muted">Teacher: {c.teacherName}</p>}
                {attendance.get(c.id) && <p className="text-sm text-muted">Attendance: {attendance.get(c.id)!.attended} of {attendance.get(c.id)!.marked} sessions</p>}
                {extras.get(c.id)?.plan?.current && <p className="text-sm">This week: <strong>{extras.get(c.id)!.plan!.current!.title}</strong></p>}
                {(extras.get(c.id)?.lessons.length ?? 0) > 0 && (
                  <p className="text-sm">
                    Lessons:{" "}
                    {extras.get(c.id)!.lessons.map((l, i) => (
                      <span key={l.id}>
                        {i > 0 && ", "}
                        <Link href={`/classes/lessons/${l.id}`} className="text-primary underline">
                          {l.title}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <LeaveClassButton classId={c.id} name={c.name} />
            </div>
            {c.assignments.length === 0 ? (
              <p className="px-6 py-5 pl-8 text-sm text-muted">Nothing assigned yet.</p>
            ) : (
<>
                {(() => {
                  const row = (a: (typeof c.assignments)[number]) => {
                  const overdue = a.cell.status !== "done" && a.dueAt && a.dueAt < now;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{a.title}</p>
                        <p className="text-xs text-muted">
                          {a.kind === "LESSONS" ? `${a.lessonIds.length || "All"} ${a.lessonIds.length === 1 ? "lesson" : "lessons"}` : a.kind === "EXTERNAL" ? `${a.cell.total} College Board ${a.cell.total === 1 ? "question" : "questions"}` : a.kind === "DIAGNOSTIC" ? "Diagnostic (timed)" : a.kind === "LOG_TEST" ? "Log an official practice test (from your score report)" : a.kind === "QUESTION_SET" ? `Practice set${a.cell.total ? ` · ${a.cell.total} questions` : ""}${a.calculator === "BY_HAND" ? " · by hand, no calculator" : ""}` : `${a.itemIds.length} ${a.itemIds.length === 1 ? "question" : "questions"}`}
                          {a.timeLimitMin ? ` · timed, ${a.timeLimitMin} min` : ""}
                          {a.classCourse ? ` · ${a.classCourse.title}` : ""}
                        </p>
                        {a.note && <p className="mt-1 text-sm text-muted">{a.note}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-xs">
                          <p className={cn(overdue ? "font-semibold text-danger" : "text-muted")}>{dueText(a.dueAt, now, zone)}</p>
                          <p className={cn("mt-1 inline-block rounded px-2 py-0.5", a.cell.status === "done" ? "bg-success-bg font-semibold text-success" : a.cell.status === "in_progress" ? "bg-warning-bg text-warning" : "bg-surface-2 text-muted")}>
                            {STATUS_LABEL[a.cell.status]}
                            {a.kind === "LESSONS" ? ` · ${a.cell.done}/${a.cell.total || "?"}` : a.cell.score !== null && (a.cell.status === "done" || !a.timeLimitMin) ? ` · ${pct(a.cell.score)}` : ""}
                          </p>
                        </div>
                        {a.kind === "LESSONS" ? (
                          <StartLessonsButton assignmentId={a.id} started={a.cell.status !== "not_started"} variant={a.cell.status === "done" ? "secondary" : "primary"} />
                        ) : (
                          <Link href={a.kind === "LOG_TEST" ? (a.cell.status === "done" ? "/practice-tests" : `/practice-tests/new?test=${a.practiceTestId}`) : a.kind === "QUESTION_SET" ? `/practice/${a.questionSetId}?assignment=${a.id}` : `/classes/assignments/${a.id}`} className={buttonClasses(a.cell.status === "done" ? "secondary" : "primary", "sm")}>
                            {a.cell.status === "done" ? "Review" : a.cell.status === "in_progress" ? "Continue" : "Start"}
                            <span className="sr-only"> {a.title}</span>
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                };
                  const todo = c.assignments.filter((a) => a.cell.status !== "done");
                  const done = c.assignments.filter((a) => a.cell.status === "done");
                  return (
                    <>
                      {todo.length > 0 ? (
                        <ul className="flex flex-col divide-y divide-border px-6 pl-8">{todo.map(row)}</ul>
                      ) : (
                        <p className="px-6 py-5 pl-8 text-sm text-success">All caught up in this class.</p>
                      )}
                      {done.length > 0 && (
                        <details className="border-t border-border px-6 py-3 pl-8">
                          <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-text">Done ({done.length})</summary>
                          <ul className="mt-1 flex flex-col divide-y divide-border">{done.map(row)}</ul>
                        </details>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
