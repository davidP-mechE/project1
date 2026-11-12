import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/misc";
import { StartPractice } from "@/components/bank/practice-player";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { practiceIntro } from "@/server/bank";

export const metadata: Metadata = { title: "Practice" };

export default async function PracticeSetPage({ params, searchParams }: PageProps<"/practice/[setId]">) {
  const user = await requireUser();
  const { setId } = await params;
  const a = (await searchParams).assignment;
  const assignmentId = typeof a === "string" && a.length <= 64 ? a : null;
  let s;
  try {
    s = await practiceIntro(user.id, setId, assignmentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href={assignmentId ? "/classes" : "/practice"} className="text-muted hover:underline">← {assignmentId ? "Classes" : "Practice sets"}</Link>
      </p>
      <PageHeader title={s.title} description={`${s.count} question${s.count === 1 ? "" : "s"}${s.timeLimitMin ? ` · ${s.timeLimitMin} minutes when timed` : ""}`} />
      {s.status === "draft" && <Alert tone="warning">This set is a draft: only authors can see it. Draft questions are included in this preview.</Alert>}
      {s.assignment?.calculator === "BY_HAND" && <Alert tone="info">Your tutor set this one as by hand: no calculator.</Alert>}
      <Card className="flex flex-col gap-3">
        {s.description && <p className="text-sm">{s.description}</p>}
        <p className="text-sm text-muted">You&apos;ll see whether each answer is right as soon as you check it, with the explanation. Starting again later gives you a fresh sitting.</p>
        <StartPractice setId={s.id} assignmentId={assignmentId} hasLimit={Boolean(s.timeLimitMin)} forcedTimed={Boolean(s.assignment?.timeLimitMin)} />
      </Card>
    </div>
  );
}
