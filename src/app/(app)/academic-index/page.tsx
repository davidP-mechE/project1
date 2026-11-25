import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { AgeCheckForm, ShareForm } from "@/components/academic-index/forms";
import { ComponentBars, HistoryChart, LeverTip, ScoreHero } from "@/components/academic-index/result-view";
import { AGE_BLOCKED_MESSAGE, getAcademicIndex, getResult } from "@/server/academic-index";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Academic Index" };

const INTRO = "One score from 0 to 230 for your whole college application: test scores, grades, course rigor, activities and essays, with feedback on how to improve.";

/** The student's Academic Index: latest score, history, and sharing. */
export default async function AcademicIndexPage() {
  const user = await requireUser();
  const [s, zone] = await Promise.all([getAcademicIndex(user.id), viewerZone()]);

  if (s.ageCheck !== "PASSED") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Academic Index" description={INTRO} />
        {s.ageCheck === "BLOCKED" ? (
          <Alert tone="info">{AGE_BLOCKED_MESSAGE}</Alert>
        ) : (
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Before you start</h2>
            <p className="text-sm text-muted">The Academic Index asks for details from your college application, so we need your date of birth first.</p>
            <AgeCheckForm />
          </Card>
        )}
      </div>
    );
  }

  const last = s.results.at(-1);
  const latest = last ? await getResult(user.id, last.id) : null;
  const waiting = s.uploads.filter((u) => u.status === "EXTRACTED" && !u.appliedAt).length;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Academic Index"
        description={INTRO}
        actions={
          <>
            <ButtonLink href="/academic-index/import" variant="secondary">Import PDFs</ButtonLink>
            <ButtonLink href="/academic-index/inputs">{latest ? "Update my answers" : "Enter by hand"}</ButtonLink>
          </>
        }
      />
      {waiting > 0 && (
        <Alert tone="info">
          {waiting} file{waiting === 1 ? " has" : "s have"} been read. <Link href="/academic-index/import" className="font-semibold underline">Review it now</Link>.
        </Alert>
      )}
      {!latest ? (
        <EmptyState title="No score yet" action={<div className="flex flex-wrap justify-center gap-2"><ButtonLink href="/academic-index/import">Upload my application PDFs</ButtonLink><ButtonLink href="/academic-index/inputs" variant="secondary">Enter everything by hand</ButtonLink></div>}>
          Upload your Common App PDF and College Board score reports and Coursebook fills in the form for you to check, or type everything in yourself.
        </EmptyState>
      ) : (
        <>
          <Card className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-muted">Scored {formatInZone(latest.createdAt, zone, "full")} · formula {latest.formulaVersion}{s.isDraft ? " · your answers have changed since" : ""}</p>
              <Link href={`/academic-index/results/${latest.id}`} className="text-sm font-semibold underline">Full results and essay feedback</Link>
            </div>
            <ScoreHero total={latest.total} tier={latest.tier} tierMessage={latest.detail.tierMessage} labels={latest.detail.labels} />
            <ComponentBars components={latest.detail.components} />
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Your biggest lever</h2>
            <LeverTip levers={latest.detail.levers} />
          </Card>
          {s.results.length > 1 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Your progress</h2>
              <HistoryChart points={s.results} zone={zone} />
              <ul className="flex flex-col divide-y divide-border text-sm">
                {[...s.results].reverse().map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`/academic-index/results/${r.id}`} className="font-medium hover:underline">{r.total} · {r.tier}{r.estimateType !== "full" ? " (estimate)" : ""}</Link>
                    <span className="text-muted">{formatInZone(r.createdAt, zone, "medium")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sharing</h2>
        <ShareForm classes={s.classes} shared={s.sharedClassIds} />
      </Card>
    </div>
  );
}
