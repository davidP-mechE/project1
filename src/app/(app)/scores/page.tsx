import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { ProgramTag } from "@/components/brand/seal";
import { WeakSpots } from "@/components/scores/cb-import-form";
import { myWeakSpots } from "@/server/cb-results";
import { Alert } from "@/components/ui/alert";
import { ScoreChart, ScoreTable } from "@/components/scores/score-chart";
import { BaselinePendingButton, GoalForm, ScoreForm, ScoreRowActions } from "@/components/scores/score-forms";
import { baselineStatus, myScores } from "@/server/scores";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ScoreGauge } from "@/components/scores/score-gauge";
import { planFor } from "@/server/pacing";
import { PlanView } from "@/components/sat/plan-view";

export const metadata: Metadata = { title: "SAT scores" };

/** A student's SAT scores: baseline, history, estimated current range, goal and test date. */
export default async function ScoresPage() {
  const user = await requireUser();
  const [h, status, programs, plan] = await Promise.all([
    myScores(user.id),
    baselineStatus(user.id),
    db.program.findMany({ where: { classes: { some: { members: { some: { userId: user.id } } } } }, select: { id: true, name: true, badge: true, targets: true, testDates: true } }),
    planFor(user.id),
  ]);
  const weak = await myWeakSpots(user.id);
  const mistakesDue = await db.mistakeItem.count({ where: { studentId: user.id, retiredAt: null, due: { lte: new Date() } } });
  const officialDates = [...new Set(programs.flatMap((p) => p.testDates.map((d) => d.toISOString().slice(0, 10))))].filter((d) => d >= new Date().toISOString().slice(0, 10)).sort();
  const targets = [...new Set(programs.flatMap((p) => p.targets))].sort((a, b) => a - b);
  const goals = h.target ? [h.target] : targets;
  const gain = h.baseline && h.latest ? h.latest.total - h.baseline.total : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {programs.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {programs.map((p) => (
            <ProgramTag key={p.id} program={p} />
          ))}
        </div>
      )}
      <PageHeader title="SAT scores" description="Your official, practice and diagnostic scores, and how far you've come." actions={h.scores.length > 0 ? <ButtonLink href="/print/report/me" variant="secondary" size="sm">Print my progress report</ButtonLink> : undefined} />
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
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card className="flex items-center justify-center">
              <ScoreGauge score={h.latest?.total ?? null} baseline={h.baseline?.total} goal={goals.at(-1) ?? null} />
            </Card>
            <Card className="grid grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <p className="eyebrow">Gain</p>
                <p className={cn("score-num text-3xl", gain !== null && gain < 0 ? "text-danger" : "text-success")}>{gain === null ? "–" : gain >= 0 ? `+${gain}` : gain}</p>
                <p className="text-xs text-muted">since your baseline ({h.baseline?.total ?? "–"})</p>
              </div>
              <div>
                <p className="eyebrow">Estimated now</p>
                <p className="score-num text-3xl">{h.projection ? `${h.projection.low}–${h.projection.high}` : "–"}</p>
                <p className="text-xs text-muted">an estimate, not an official score</p>
              </div>
              <div>
                <p className="eyebrow">To your goal</p>
                <p className="score-num text-3xl">{h.latest && goals.length ? Math.max(0, goals.at(-1)! - h.latest.total) : "–"}</p>
                <p className="text-xs text-muted">{goals.length ? `points to ${goals.at(-1)}` : "set a goal below"}</p>
              </div>
              <div>
                <p className="eyebrow">Mistakes due</p>
                <p className="score-num text-3xl">{mistakesDue}</p>
                <p className="text-xs text-muted">
                  in your <Link href="/mistakes" className="underline">mistake log</Link>
                </p>
              </div>
            </Card>
          </div>
          <Card>
            <h2 className="mb-3 text-lg font-semibold">Your progress</h2>
            <ScoreChart points={h.scores} targets={goals} projection={h.projection} />
            {h.stall.stalled && <Alert tone="warning" className="mt-3">{h.stall.reason}. Talk to your tutor about what to focus on next.</Alert>}
          </Card>
          <Card>
            <h2 className="mb-1 text-lg font-semibold">Where to focus</h2>
            <p className="mb-4 text-sm text-muted">Your weakest content areas first, from your College Board reports and question reviews and your practice here.</p>
            <WeakSpots data={weak} />
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
      <p className="text-sm text-muted">
        <a href="/api/me/sat-export" download className="underline">
          Download all your tutoring records
        </a>{" "}
        (scores, answers, attendance and mistake log, as a file).
      </p>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Your plan to test day</h2>
        {plan ? <PlanView weeks={plan.weeks} testDate={plan.testDate} /> : <p className="text-sm text-muted">Choose your SAT date above, and you&apos;ll get a week-by-week plan back from it.</p>}
      </Card>
    </div>
  );
}
