import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { AttemptCommentForm } from "@/components/classes/attempt-comment-form";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { tutorAttempt } from "@/server/tutor-view";
import { can } from "@/server/access";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Logged practice test" };

/** A student's logged practice test, read-only, with comments. */
export default async function TutorAttemptPage({ params }: PageProps<"/teach/[classId]/attempts/[attemptId]">) {
  const user = await requireUser();
  const { classId, attemptId } = await params;
  let a;
  try {
    a = await tutorAttempt(user.id, classId, attemptId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/${classId}/students/${a.user.id}/practice`} className="text-muted hover:underline">← {a.user.name}</Link>
      </p>
      <PageHeader
        title={a.test.name}
        description={[formatInZone(a.dateTaken, "UTC", "medium"), a.total ? `${a.total} (R&W ${a.scoreRw ?? "–"}, Math ${a.scoreMath ?? "–"})` : "no score yet", a.minutesUsed ? `${a.minutesUsed} min` : null, a.status === "complete" ? "complete" : "draft"].filter(Boolean).join(" · ")}
      />
      {a.notes && <Card><p className="text-sm">Student&apos;s notes: {a.notes}</p></Card>}
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Missed, skipped or guessed ({a.items.length})</h2>
        {a.items.length === 0 ? (
          <p className="text-sm text-muted">None logged.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {a.items.map((i) => (
              <li key={i.id} className="flex flex-wrap gap-x-3 py-2">
                <span className="w-28 font-semibold">{i.section === "rw" ? "R&W" : "Math"} M{i.module} #{i.questionNumber}</span>
                <span className="w-16">{i.result}</span>
                <span className="flex-1">{i.skill?.name ?? "no skill"} · {i.errorType?.label ?? "no error type"}</span>
                {i.note && <span className="w-full text-muted">{i.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Comments</h2>
        {a.comments.map((c) => (
          <div key={c.id} className="rounded border border-border p-3 text-sm">
            <p className="whitespace-pre-wrap">{c.body}</p>
            <p className="mt-1 text-xs text-muted">{c.author.name} · {formatInZone(c.createdAt, "UTC", "medium")}</p>
          </div>
        ))}
        {can(a.access, "teach") ? <AttemptCommentForm classId={classId} attemptId={a.id} /> : <p className="text-sm text-muted">Viewers can read comments but not add them.</p>}
      </Card>
    </div>
  );
}
