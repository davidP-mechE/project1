import type { Metadata } from "next";
import Link from "next/link";
import { CbImportForm } from "@/components/scores/cb-import-form";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { ClassNav } from "@/components/classes/class-nav";
import { ScoreStats } from "@/components/scores/stats";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classScores } from "@/server/scores";
import { listGroups } from "@/server/groups";
import { requireUser } from "@/server/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Scores" };

/** The class's SAT scores: gains, who's on track, who's stalling, who has no baseline. */
export default async function ClassScoresPage({ params, searchParams }: PageProps<"/teach/[classId]/scores">) {
  const user = await requireUser();
  const { classId } = await params;
  const group = (await searchParams).group;
  const groupId = typeof group === "string" ? group : undefined;
  let c, s, g;
  try {
    [c, s, g] = await Promise.all([getClassForTeacher(user.id, classId), classScores(user.id, classId, { groupId }), listGroups(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <ClassNav c={c} active="scores" />
      <p className="-mt-2 text-sm">
        <Link href={`/print/class/${classId}`} className="font-medium text-primary underline-offset-2 hover:underline">
          Print class summary
        </Link>
      </p>
      {s.access.role !== "VIEWER" && (
        <details className="rounded-2xl border border-border bg-surface p-5">
          <summary className="cursor-pointer text-lg font-semibold">Import College Board score reports</summary>
          <div className="mt-4">
            <CbImportForm classId={classId} />
          </div>
        </details>
      )}
      {g.groups.length > 0 && (
        <nav aria-label="Filter by group" className="flex flex-wrap gap-2 text-sm">
          <Link href={`/teach/${classId}/scores`} className={cn("rounded-full border px-3 py-1", !groupId ? "border-primary bg-primary/10 font-medium" : "border-border")} aria-current={!groupId ? "page" : undefined}>
            Everyone
          </Link>
          {g.groups.map((x) => (
            <Link key={x.id} href={`/teach/${classId}/scores?group=${x.id}`} className={cn("rounded-full border px-3 py-1", groupId === x.id ? "border-primary bg-primary/10 font-medium" : "border-border")} aria-current={groupId === x.id ? "page" : undefined}>
              {x.name}
            </Link>
          ))}
        </nav>
      )}
      {s.stats.students === 0 ? (
        <EmptyState title="No students yet">Once students join, their scores show here.</EmptyState>
      ) : (
        <>
          <ScoreStats stats={s.stats} />
          {s.students ? (
            <Card>
              <h2 className="mb-3 text-lg font-semibold">Students</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Each student&apos;s baseline, latest and estimated score</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-medium">Student</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Baseline</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Latest</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Gain</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Estimate now</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Goal</th>
                      <th scope="col" className="py-2 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {s.students.map((r) => (
                      <tr key={r.id}>
                        <th scope="row" className="py-2 pr-3 font-medium">
                          <Link href={`/teach/${classId}/students/${r.id}`} className="text-primary underline-offset-2 hover:underline">
                            {r.name}
                          </Link>
                        </th>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.baseline ?? "–"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.latest ?? "–"}</td>
                        <td className={cn("py-2 pr-3 text-right font-medium tabular-nums", r.baseline !== null && r.latest !== null && r.latest - r.baseline < 0 && "text-danger")}>{r.baseline !== null && r.latest !== null ? (r.latest - r.baseline >= 0 ? `+${r.latest - r.baseline}` : r.latest - r.baseline) : "–"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.projection ? `${r.projection.low}–${r.projection.high}` : "–"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.target}</td>
                        <td className="py-2 text-xs">
                          {r.baseline === null && <span className="mr-1 rounded bg-warning-bg px-1.5 py-0.5 font-medium text-warning">{r.baselinePending ? "Diagnostic pending" : "No baseline"}</span>}
                          {r.stall.stalled && <span className="rounded bg-danger-bg px-1.5 py-0.5 font-medium text-danger">{r.stall.reason}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted">&quot;Estimate now&quot; follows each student&apos;s recent scores and practice. It isn&apos;t an official score.</p>
            </Card>
          ) : (
            <Alert tone="info">With fewer than 5 students in view, viewers see the class&apos;s numbers only, so no one can be singled out.</Alert>
          )}
        </>
      )}
    </div>
  );
}
