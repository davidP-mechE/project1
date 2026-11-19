import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { attentionList, REASON_LABEL } from "@/server/attention";

/** Today, for staff: the top of the needs-attention list. Server component (streamed in a Suspense boundary). */
export async function AttentionSummary({ userId }: { userId: string }) {
  const { items } = await attentionList(userId).catch(() => ({ items: [] }));
  const students = new Set(items.map((i) => i.studentId)).size;
  return (
    <section aria-labelledby="attention-today">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="attention-today" className="text-lg font-semibold">
            Needs attention
          </h2>
          <ButtonLink href="/teach/attention" size="sm" variant="secondary">
            {items.length ? `See all ${items.length}` : "Open the list"}
          </ButtonLink>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Nobody in your classes needs a nudge right now.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {students} student{students === 1 ? "" : "s"} may need a nudge. The most urgent:
            </p>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {items.slice(0, 3).map((i) => (
                <li key={i.key} className="flex flex-wrap items-baseline gap-x-2 py-2">
                  <Link href={`/teach/${i.classId}/students/${i.studentId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {i.name}
                  </Link>
                  <span className="font-semibold">{REASON_LABEL[i.reason]}</span>
                  <span className="text-muted">{i.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}

export function AttentionSummarySkeleton() {
  return (
    <Card className="flex flex-col gap-3" aria-busy="true">
      <p className="text-lg font-semibold">Needs attention</p>
      <p className="text-sm text-muted" role="status">Checking your classes…</p>
    </Card>
  );
}
