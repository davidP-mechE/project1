import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, ProgressBar } from "@/components/ui/misc";
import { RetakeButton } from "@/components/sat/diagnostic-forms";
import { NotFoundError } from "@/server/courses";
import { diagnosticReport } from "@/server/diagnostics";
import { sectionName } from "@/lib/sat/domains";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Diagnostic results" };

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

/** How the class did on a diagnostic: each student's estimated scores and route, by domain, and with and without Desmos. */
export default async function DiagnosticResultsPage({ params }: PageProps<"/teach/[classId]/diagnostics/[assignmentId]">) {
  const user = await requireUser();
  const { classId, assignmentId } = await params;
  let r;
  try {
    r = await diagnosticReport(user.id, assignmentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (r.assignment.classId !== classId) notFound();
  const canGrade = r.access.role !== "VIEWER";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/${classId}`} className="text-muted hover:text-text hover:underline">
          ← {r.access.className}
        </Link>
      </p>
      <PageHeader title={r.assignment.title} description={`${r.students.filter((s) => s.status === "done").length} of ${r.students.length} finished · estimated scores, not official`} />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Students</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Each student&apos;s diagnostic results</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Student</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 pr-3 font-medium">Sections (estimate, route)</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Total</th>
                {canGrade && <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.students.map((s) => (
                <tr key={s.student.id}>
                  <th scope="row" className="py-2 pr-3 font-medium">{s.student.name}</th>
                  <td className="py-2 pr-3">{s.status === "done" ? "Done" : s.status === "in_progress" ? "Taking it" : "Not started"}{s.attempts > 1 && ` (attempt ${s.attempts})`}</td>
                  <td className="py-2 pr-3">{s.results?.sections.map((x) => `${sectionName(x.section)} ${x.estimate} (${x.route === "M2_HARD" ? "harder" : "easier"})`).join(" · ") ?? "–"}</td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums">{s.results?.total ?? "–"}</td>
                  {canGrade && <td className="py-2">{s.status === "done" && <RetakeButton classId={classId} assignmentId={assignmentId} studentId={s.student.id} name={s.student.name} />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">By domain</h2>
        <ul className="flex flex-col gap-3">
          {r.domains.map((d) => (
            <li key={d.domain} className="flex flex-col gap-1">
              <span className="flex justify-between text-sm">
                <span>{d.name}</span>
                <span className="tabular-nums text-muted">
                  {pct(d.accuracy)} · {d.answered} answers{d.avgSeconds !== null && ` · ${d.avgSeconds}s each`}
                </span>
              </span>
              <ProgressBar value={(d.accuracy ?? 0) * 100} label={`${d.name}: ${pct(d.accuracy)} right`} />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Desmos on calculator-friendly questions</h2>
        <p className="mb-3 text-sm text-muted">On questions tagged &quot;Desmos helps&quot;: accuracy when students opened the calculator, and when they didn&apos;t.</p>
        <p className="text-sm">
          With Desmos: <strong>{pct(r.desmos.with.accuracy)}</strong> ({r.desmos.with.answered} answers) · Without: <strong>{pct(r.desmos.without.accuracy)}</strong> ({r.desmos.without.answered} answers)
        </p>
      </Card>
    </div>
  );
}
