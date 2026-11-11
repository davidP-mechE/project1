import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { InsightsView } from "@/components/tracker/insights-view";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { studentPractice } from "@/server/tutor-view";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Student SAT practice" };

/** A student's official-practice picture, for staff whose class (and scope) includes them. */
export default async function StudentPracticePage({ params }: PageProps<"/teach/[classId]/students/[studentId]/practice">) {
  const user = await requireUser();
  const { classId, studentId } = await params;
  let p;
  try {
    p = await studentPractice(user.id, classId, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const redoTotal = p.redo.to_redo + p.redo.redone_correct + p.redo.still_wrong;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/${classId}/practice`} className="text-muted hover:underline">← {p.access.className}: SAT practice</Link>
        {" · "}
        <Link href={`/teach/${classId}/students/${studentId}`} className="text-muted hover:underline">Scores</Link>
      </p>
      <PageHeader title={p.student.name} description="Logged official practice tests and Coursebook practice sets." />
      <Card className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="score-num text-2xl">{p.redo.to_redo}</p>
          <p className="text-xs text-muted">to redo</p>
        </div>
        <div>
          <p className="score-num text-2xl text-success">{p.redo.redone_correct}</p>
          <p className="text-xs text-muted">redone correctly</p>
        </div>
        <div>
          <p className="score-num text-2xl text-danger">{p.redo.still_wrong}</p>
          <p className="text-xs text-muted">still wrong</p>
        </div>
        <p className="col-span-3 text-xs text-muted">Redo list progress: {redoTotal ? Math.round((p.redo.redone_correct / redoTotal) * 100) : 0}% of {redoTotal} logged misses redone correctly.</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent logs</h2>
        {p.logs.length === 0 ? (
          <p className="text-sm text-muted">No logs yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {p.logs.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 py-3">
                <Link href={`/teach/${classId}/attempts/${l.id}`} className="flex flex-wrap items-center gap-3 hover:underline">
                  <span className="flex-1 font-semibold">{l.test.name}</span>
                  <span className="text-sm text-muted">{formatInZone(l.dateTaken, "UTC", "medium")}</span>
                  <span className="score-num">{l.total ?? "–"}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", l.status === "complete" ? "bg-success-bg text-success" : "bg-warning-bg text-warning")}>{l.status === "complete" ? "Complete" : "Draft"}</span>
                </Link>
                <p className="text-sm text-muted">
                  {l._count.items} missed, skipped or guessed{l.minutesUsed ? ` · ${l.minutesUsed} min` : ""}
                  {l.comments.length ? ` · ${l.comments.length} comment${l.comments.length === 1 ? "" : "s"}` : ""}
                </p>
                {l.notes && <p className="text-sm">&ldquo;{l.notes}&rdquo;</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <InsightsView data={p.insights} who="student" />
    </div>
  );
}
