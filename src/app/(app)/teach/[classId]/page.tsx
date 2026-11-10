import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { dueText, pct } from "@/components/classes/format";
import { cn } from "@/lib/utils";
import { NotFoundError } from "@/server/courses";
import { classProgress, getClassForTeacher, type Cell } from "@/server/classes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Class progress" };

function CellView({ cell, questions }: { cell: Cell; questions: boolean }) {
  const label = cell.status === "done" ? (questions ? pct(cell.score) : "Done") : cell.status === "in_progress" ? (questions ? `${cell.done}/${cell.total}` : `${cell.done}/${cell.total}`) : "—";
  return (
    <span
      className={cn(
        "inline-flex min-w-14 justify-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums",
        cell.status === "done" ? (questions && (cell.score ?? 0) < 0.6 ? "bg-warning-bg text-warning" : "bg-success-bg text-success") : cell.late ? "bg-danger-bg text-danger" : cell.status === "in_progress" ? "bg-surface-2 text-text" : "text-muted",
      )}
    >
      {label}
      {cell.late && cell.status !== "done" && <span className="sr-only"> (overdue)</span>}
      {cell.late && cell.status === "done" && <span className="ml-1 font-normal">late</span>}
    </span>
  );
}

/** The teacher's overview: every student × every assignment, with class averages. */
export default async function ClassProgressPage({ params }: PageProps<"/teach/[classId]">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, grid;
  try {
    [c, grid] = await Promise.all([getClassForTeacher(user.id, classId), classProgress(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const now = new Date();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="overview" />
      {c.members.length === 0 ? (
        <EmptyState title="No students yet" action={<ButtonLink href={`/teach/${c.id}/students`}>Invite students</ButtonLink>}>
          Share the class code <strong>{c.joinCode}</strong> or invite students by email.
        </EmptyState>
      ) : grid.assignments.length === 0 ? (
        <EmptyState
          title="Nothing assigned yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={`/teach/${c.id}/assign`}>Assign lessons</ButtonLink>
              <ButtonLink href="/teach/worksheets" variant="secondary">
                Assign worksheet questions
              </ButtonLink>
            </div>
          }
        >
          Assign lessons from your courses, or questions from a worksheet you upload.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <caption className="px-5 pt-5 text-left text-lg font-semibold">Progress</caption>
              <thead>
                <tr className="border-b border-border text-left align-bottom">
                  <th scope="col" className="sticky left-0 bg-surface px-5 py-3 font-medium">
                    Student
                  </th>
                  {grid.assignments.map((a) => (
                    <th key={a.id} scope="col" className="max-w-40 px-3 py-3 font-medium">
                      <Link href={`/teach/${c.id}/assignments/${a.id}`} className="line-clamp-2 hover:underline">
                        {a.title}
                      </Link>
                      <span className={cn("block text-xs font-normal", a.dueAt && a.dueAt < now ? "text-danger" : "text-muted")}>{a.dueAt ? dueText(a.dueAt, now) : a.kind === "LESSONS" ? "Lessons" : "Questions"}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.students.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <th scope="row" className="sticky left-0 bg-surface px-5 py-2.5 text-left font-medium">
                      {s.name || s.email}
                    </th>
                    {grid.assignments.map((a) => (
                      <td key={a.id} className="px-3 py-2.5">
                        <CellView cell={grid.cells[`${s.id}:${a.id}`]} questions={a.kind === "QUESTIONS"} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 text-xs">
                  <th scope="row" className="sticky left-0 bg-surface-2 px-5 py-2.5 text-left font-medium">
                    Class
                  </th>
                  {grid.summary.map((x, i) => (
                    <td key={x.id} className="px-3 py-2.5 tabular-nums text-muted">
                      {x.done}/{grid.students.length} done{grid.assignments[i].kind === "QUESTIONS" ? ` · avg ${pct(x.average)}` : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-5 pb-4 pt-2 text-xs text-muted">Scores are the latest answer to each question. Red: overdue. Amber: done, under 60%. Open an assignment for each question and answer.</p>
        </Card>
      )}
    </div>
  );
}
