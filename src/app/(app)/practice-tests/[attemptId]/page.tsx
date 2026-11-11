import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Recorder, type RecorderData } from "@/components/tracker/recorder";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { getAttempt, trackerOptions } from "@/server/tracker";

export const metadata: Metadata = { title: "Practice test log" };

export default async function AttemptPage({ params }: PageProps<"/practice-tests/[attemptId]">) {
  const user = await requireUser();
  const { attemptId } = await params;
  let a;
  try {
    a = await getAttempt(user.id, attemptId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { skills, errorTypes } = await trackerOptions();
  const data: RecorderData = {
    id: a.id,
    testName: a.test.name,
    status: a.status,
    dateTaken: a.dateTaken.toISOString(),
    scoreRw: a.scoreRw,
    scoreMath: a.scoreMath,
    total: a.total,
    minutesUsed: a.minutesUsed,
    notes: a.notes,
    modules: a.modules,
    items: a.items.map((i) => ({ section: i.section, module: i.module, questionNumber: i.questionNumber, result: i.result, skillId: i.skillId, errorTypeId: i.errorTypeId, note: i.note })),
  };
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/practice-tests" className="text-muted hover:underline">← SAT practice log</Link>
      </p>
      <PageHeader title={a.test.name} description="Mark what you missed from your score report. You can come back and finish later." />
      <Recorder data={data} skills={skills} errorTypes={errorTypes} />
      {a.comments.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Comments from your tutor</h2>
          {a.comments.map((c) => (
            <div key={c.id} className="rounded border border-border p-3 text-sm">
              <p className="whitespace-pre-wrap">{c.body}</p>
              <p className="mt-1 text-xs text-muted">{c.author.name} · {c.createdAt.toISOString().slice(0, 10)}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
