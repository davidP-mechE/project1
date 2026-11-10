import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { ScoreChart, ScoreTable } from "@/components/scores/score-chart";
import { ScoreForm, ScoreRowActions } from "@/components/scores/score-forms";
import { NotFoundError } from "@/server/courses";
import { studentScoresForStaff } from "@/server/scores";
import { requireUser } from "@/server/session";
import { db } from "@/server/db";
import { planFor } from "@/server/pacing";
import { openMistakesByDomain } from "@/server/mistakes";
import { PlanView } from "@/components/sat/plan-view";
import { GuardianForm } from "@/components/classes/cohort-forms";
import { guardiansOf } from "@/server/cohort";

export const metadata: Metadata = { title: "Student" };

/** One student's scores, as a staff member in scope sees them. */
export default async function StudentPage({ params }: PageProps<"/teach/[classId]/students/[studentId]">) {
  const user = await requireUser();
  const { classId, studentId } = await params;
  let s;
  try {
    s = await studentScoresForStaff(user.id, classId, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  // The student is in the caller's scope (checked above).
  const [program, plan, mistakes] = await Promise.all([db.program.findUniqueOrThrow({ where: { id: s.access.programId }, select: { targets: true } }), planFor(studentId), openMistakesByDomain(studentId)]);
  const sections = { rw: s.scores.some((x) => x.rw !== null) || !s.access.subjects, math: s.scores.some((x) => x.math !== null) || !s.access.subjects };
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/${classId}/scores`} className="text-muted hover:text-text hover:underline">
          ← {s.access.className} scores
        </Link>
      </p>
      <PageHeader
        title={s.student.name || "Student"}
        description={[s.baseline ? `Baseline ${s.baseline.total}` : s.baselinePending ? "Diagnostic pending" : "No baseline yet", s.latest ? `latest ${s.latest.total}` : null, s.target ? `goal ${s.target}` : null, s.testDate ? `SAT on ${s.testDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : null].filter(Boolean).join(" · ")}
      />
      {s.stall.stalled && <Alert tone="warning">{s.stall.reason}.</Alert>}
      {s.scores.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Progress</h2>
          <ScoreChart points={s.scores} targets={s.target ? [s.target] : program.targets} projection={s.projection} />
        </Card>
      )}
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Scores</h2>
        {s.scores.length === 0 ? (
          <p className="text-sm text-muted">No scores yet.</p>
        ) : (
          <ScoreTable scores={s.scores} showSections={sections} actions={s.canEdit ? (id, verified) => <ScoreRowActions scoreId={id} verified={verified} canDelete verify={{ classId, studentId }} /> : undefined} />
        )}
        {s.access.subjects && <p className="mt-3 text-xs text-muted">You see the total and the sections you cover.</p>}
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Open mistakes</h2>
        {mistakes.length === 0 ? (
          <p className="text-sm text-muted">None open.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {mistakes.map((m) => (
              <li key={m.domain ?? "none"} className="flex justify-between py-1.5">
                <span>{m.name}</span>
                <span className="tabular-nums text-muted">{m.open}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {plan && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Plan to test day</h2>
          <PlanView weeks={plan.weeks} testDate={plan.testDate} />
        </Card>
      )}
      {(s.access.role === "ADMIN" || s.access.role === "TEACHER") && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Guardians</h2>
          <p className="mb-3 text-sm text-muted">Weekly progress emails go only to guardians who agreed, and only when the class has them turned on.</p>
          <GuardianForm classId={classId} studentId={studentId} guardians={await guardiansOf(user.id, studentId, classId)} />
        </Card>
      )}
      {s.canEdit && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Add a score for {s.student.name || "this student"}</h2>
          <ScoreForm target={{ classId, studentId }} />
        </Card>
      )}
    </div>
  );
}
