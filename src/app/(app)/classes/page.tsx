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
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Classes" };

/** The student's classes: join one with a code; see what's assigned, when it's due, and how they did. */
export default async function ClassesPage() {
  const user = await requireUser();
  const [classes, attendance] = await Promise.all([myClasses(user.id), myAttendance(user.id)]);
  const extras = new Map(
    await Promise.all(
      classes.map(async (c) => [c.id, { plan: await publishedPlan(user.id, c.id).catch(() => null), lessons: (await classLessons(user.id, c.id).catch(() => ({ lessons: [] }))).lessons }] as const),
    ),
  );
  const now = new Date();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <BaselineBanner userId={user.id} />
      <PageHeader title="Classes" description="Work your teachers assign, with due dates. Your progress on it is shared with them." />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Join a class</h2>
        <JoinCodeForm />
      </Card>
      {classes.length === 0 ? (
        <EmptyState title="No classes yet">Ask your teacher for the class code or an invite link.</EmptyState>
      ) : (
        classes.map((c) => (
          <Card key={c.id}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">{c.name}</h2>
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
              <p className="text-sm text-muted">Nothing assigned yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {c.assignments.map((a) => {
                  const overdue = a.cell.status !== "done" && a.dueAt && a.dueAt < now;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{a.title}</p>
                        <p className="text-xs text-muted">
                          {a.kind === "LESSONS" ? `${a.lessonIds.length || "All"} ${a.lessonIds.length === 1 ? "lesson" : "lessons"}` : a.kind === "EXTERNAL" ? `${a.cell.total} College Board ${a.cell.total === 1 ? "question" : "questions"}` : a.kind === "DIAGNOSTIC" ? "Diagnostic (timed)" : `${a.itemIds.length} ${a.itemIds.length === 1 ? "question" : "questions"}`}
                          {a.timeLimitMin ? ` · timed, ${a.timeLimitMin} min` : ""}
                          {a.classCourse ? ` · ${a.classCourse.title}` : ""}
                        </p>
                        {a.note && <p className="mt-1 text-sm text-muted">{a.note}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-xs">
                          <p className={cn(overdue ? "font-semibold text-danger" : "text-muted")}>{dueText(a.dueAt, now)}</p>
                          <p className={cn(a.cell.status === "done" ? "text-success" : "text-muted")}>
                            {STATUS_LABEL[a.cell.status]}
                            {a.kind === "LESSONS" ? ` · ${a.cell.done}/${a.cell.total || "?"}` : a.cell.score !== null && (a.cell.status === "done" || !a.timeLimitMin) ? ` · ${pct(a.cell.score)}` : ""}
                          </p>
                        </div>
                        {a.kind === "LESSONS" ? (
                          <StartLessonsButton assignmentId={a.id} started={a.cell.status !== "not_started"} variant={a.cell.status === "done" ? "secondary" : "primary"} />
                        ) : (
                          <Link href={`/classes/assignments/${a.id}`} className={buttonClasses(a.cell.status === "done" ? "secondary" : "primary", "sm")}>
                            {a.cell.status === "done" ? "Review" : a.cell.status === "in_progress" ? "Continue" : "Start"}
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
