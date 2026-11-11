import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { Markdown } from "@/components/lesson/markdown";
import { ClassNav } from "@/components/classes/class-nav";
import { ReviewGradeForm } from "@/components/classes/staff-forms";
import { pct } from "@/components/classes/format";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { aiGradesToReview } from "@/server/grade-review";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Review AI grades" };

/** Written answers Claude graded, for the students and subjects in your scope: confirm or override each. */
export default async function ReviewPage({ params, searchParams }: PageProps<"/teach/[classId]/review">) {
  const user = await requireUser();
  const { classId } = await params;
  const all = (await searchParams).show === "all";
  let c, r;
  try {
    [c, r] = await Promise.all([getClassForTeacher(user.id, classId), aiGradesToReview(user.id, classId, { include: all ? "all" : "pending" })]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="review" />
      <p className="text-sm text-muted">
        Claude grades written answers against your answer key. Check them here: confirm a grade, or override it (students see your grade and feedback).{" "}
        <Link className="text-primary underline" href={all ? `/teach/${classId}/review` : `/teach/${classId}/review?show=all`}>
          {all ? "Show only ones to review" : "Show reviewed ones too"}
        </Link>
      </p>
      {r.answers.length === 0 ? (
        <EmptyState title="Nothing to review">{all ? "No AI-graded answers yet." : "Every AI grade in your scope has been reviewed."}</EmptyState>
      ) : (
        r.answers.map((a) => (
          <Card key={a.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
              <span>
                {a.user.name || "Student"} · {a.assignment.title} · question {a.item.label}
              </span>
              <span>{a.reviewedAt ? "Reviewed" : "To review"}</span>
            </div>
            <Markdown className="text-sm">{a.item.prompt}</Markdown>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-xs font-medium text-muted">Student&apos;s answer</p>
                <Markdown className="[&_p]:m-0">{a.response || "_(blank)_"}</Markdown>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-xs font-medium text-muted">Answer key</p>
                <Markdown className="[&_p]:m-0">{a.item.answer}</Markdown>
              </div>
            </div>
            <p className="text-sm">
              <span className="font-medium">Grade: {pct(a.score)}</span>
              {a.aiScore !== null && <span className="text-muted"> (Claude gave {pct(a.aiScore)})</span>} · {a.feedback}
            </p>
            {r.canGrade && <ReviewGradeForm classId={classId} answerId={a.id} score={a.score} />}
          </Card>
        ))
      )}
    </div>
  );
}
