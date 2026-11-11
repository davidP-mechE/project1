import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { db } from "@/server/db";
import { aiGradesToReview } from "@/server/grade-review";
import { staffClassIds } from "@/server/access";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Review queue" };

/** Everything AI-made that's waiting for a person: drafted questions, drafted lessons, AI grades. */
export default async function ReviewQueuePage() {
  const user = await requireUser();
  const classIds = await staffClassIds(user.id);
  const [drafts, lessons] = await Promise.all([
    db.worksheet.findMany({ where: { ownerId: user.id, source: "AI_DRAFT", items: { some: { approvedAt: null, archivedAt: null } } }, select: { id: true, title: true, _count: { select: { items: { where: { approvedAt: null, archivedAt: null } } } } } }),
    db.draftLesson.findMany({ where: { classId: { in: classIds }, approvedAt: null }, select: { id: true, title: true, classId: true, class: { select: { name: true } } } }),
  ]);
  const grades = [];
  for (const id of classIds) {
    const r = await aiGradesToReview(user.id, id).catch(() => null);
    if (r && r.answers.length) grades.push({ classId: id, name: r.access.className, count: r.answers.length });
  }
  const empty = !drafts.length && !lessons.length && !grades.length;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Review queue" description="Nothing Claude writes reaches students until someone here approves it." />
      {empty ? (
        <EmptyState title="All reviewed">No drafts or AI grades are waiting for you.</EmptyState>
      ) : (
        <>
          {drafts.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold">Drafted questions</h2>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {drafts.map((d) => (
                  <li key={d.id} className="flex justify-between py-2">
                    <Link href={`/teach/worksheets/${d.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {d.title}
                    </Link>
                    <span className="text-muted">{d._count.items} to approve</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {lessons.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold">Drafted lessons</h2>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {lessons.map((l) => (
                  <li key={l.id} className="flex justify-between py-2">
                    <Link href={`/teach/${l.classId}/assistant`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {l.title}
                    </Link>
                    <span className="text-muted">{l.class.name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {grades.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold">AI grades</h2>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {grades.map((g) => (
                  <li key={g.classId} className="flex justify-between py-2">
                    <Link href={`/teach/${g.classId}/review`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {g.name}
                    </Link>
                    <span className="text-muted">{g.count} to review</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
