import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { ScoreChart, ScoreTable } from "@/components/scores/score-chart";
import { BaselinePendingButton, GoalForm, ScoreForm, ScoreRowActions } from "@/components/scores/score-forms";
import { baselineStatus, myScores } from "@/server/scores";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";
import { planFor } from "@/server/pacing";
import { PlanView } from "@/components/sat/plan-view";

export const metadata: Metadata = { title: "SAT scores" };

/** A student's SAT scores: baseline, history, estimated current range, goal and test date. */
export default async function ScoresPage() {
  const user = await requireUser();
  const [h, status, programs, plan] = await Promise.all([
    myScores(user.id),
    baselineStatus(user.id),
    db.program.findMany({ where: { classes: { some: { members: { some: { userId: user.id } } } } }, select: { targets: true, testDates: true } }),
    planFor(user.id),
  ]);
  const officialDates = [...new Set(programs.flatMap((p) => p.testDates.map((d) => d.toISOString().slice(0, 10))))].filter((d) => d >= new Date().toISOString().slice(0, 10)).sort();
  const targets = [...new Set(programs.flatMap((p) => p.targets))].sort((a, b) => a - b);
  const goals = h.target ? [h.target] : targets;
  const gain = h.baseline && h.latest ? h.latest.total - h.baseline.total : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="SAT scores" description="Your official, practice and diagnostic scores, and how far you've come." />
      {h.scores.length === 0 ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Start with your baseline</h2>
          <p className="text-sm text-muted">
            Your most recent SAT, PSAT or practice-test score. Your progress is measured from it.{status.needed && " Your tutoring program asks every student for one."}
          </p>
          {status.pending ? (
            <Alert tone="info">You said you&apos;ll take the diagnostic first. When your tutor assigns it, its score becomes your baseline. If you find an old score, you can add it below.</Alert>
          ) : (
            <BaselinePendingButton />
          )}
          <ScoreForm first />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Baseline</span>
              <span className="text-3xl font-semibold tabular-nums">{h.baseline?.total ?? "–"}</span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Latest</span>
              <span className="text-3xl font-semibold tabular-nums">{h.latest?.total ?? "–"}</span>
              {gain !== null && <span className={gain >= 0 ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>{gain >= 0 ? `+${gain}` : gain} since your baseline</span>}
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Estimated now</span>
              <span className="text-3xl font-semibold tabular-nums">{h.projection ? `${h.projection.low}–${h.projection.high}` : "–"}</span>
              <span className="text-xs text-muted">An estimate from your recent scores and practice, not an official score.</span>
            </Card>
          </div>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">Your progress</h2>
            <ScoreChart points={h.scores} targets={goals} projection={h.projection} />
            {h.stall.stalled && <Alert tone="warning" className="mt-3">{h.stall.reason}. Talk to your tutor about what to focus on next.</Alert>}
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">All scores</h2>
            <ScoreTable scores={h.scores} actions={(id, verified) => <ScoreRowActions scoreId={id} verified={verified} canDelete={!verified} />} />
          </Card>
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Add a score</h2>
            <ScoreForm />
          </Card>
        </>
      )}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Goal and test date</h2>
        <GoalForm targetScore={h.target} testDate={h.testDate ? h.testDate.toISOString().slice(0, 10) : null} targets={targets} officialDates={officialDates} />
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Your plan to test day</h2>
        {plan ? <PlanView weeks={plan.weeks} testDate={plan.testDate} /> : <p className="text-sm text-muted">Choose your SAT date above, and you&apos;ll get a week-by-week plan back from it.</p>}
      </Card>
    </div>
  );
}
