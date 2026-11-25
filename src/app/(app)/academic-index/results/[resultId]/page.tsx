import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/misc";
import { DeleteResultButton } from "@/components/academic-index/forms";
import { ComponentBars, EssayFeedback, LeverTip, ScoreHero } from "@/components/academic-index/result-view";
import { getResult } from "@/server/academic-index";
import { NotFoundError } from "@/server/courses";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Academic Index results" };

/** Results (spec section 8): score and tier, five bars, essay feedback, the biggest lever, the disclaimer. */
export default async function ResultPage({ params }: PageProps<"/academic-index/results/[resultId]">) {
  const user = await requireUser();
  const { resultId } = await params;
  let r;
  try {
    r = await getResult(user.id, resultId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const zone = await viewerZone();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm"><Link href="/academic-index" className="text-muted hover:text-text hover:underline">← Academic Index</Link></p>
      <PageHeader title="Your Academic Index" description={`Scored ${formatInZone(r.createdAt, zone, "full")} · formula ${r.formulaVersion}`} actions={<ButtonLink href="/academic-index/inputs" variant="secondary">Update my answers</ButtonLink>} />
      <Card className="flex flex-col gap-6">
        <ScoreHero total={r.total} tier={r.tier} tierMessage={r.detail.tierMessage} labels={r.detail.labels} />
        <ComponentBars components={r.detail.components} />
        {r.detail.satUsed !== null && (
          <p className="text-xs text-muted">
            Test score from {r.detail.testSource === "ACT" ? `your ACT, converted to SAT ${r.detail.satUsed}` : `your SAT superscore, ${r.detail.satUsed}`}. GPA used: {r.detail.gpaUsed.toFixed(2)}. Top activities: {r.detail.activityPoints.join(" + ") || "none"}.
          </p>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your biggest lever</h2>
        <LeverTip levers={r.detail.levers} />
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Essay feedback</h2>
        {r.detail.essayNote && <Alert tone="info">{r.detail.essayNote}</Alert>}
        <EssayFeedback essays={r.essays} />
      </Card>
      <div><DeleteResultButton resultId={r.id} /></div>
    </div>
  );
}
