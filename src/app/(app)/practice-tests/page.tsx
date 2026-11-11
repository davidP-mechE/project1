import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/server/session";
import { myAttempts } from "@/server/tracker";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "SAT practice log" };

/** A tracker for your official SAT practice: the student's logged tests. */
export default async function PracticeTestsPage() {
  const user = await requireUser();
  const attempts = await myAttempts(user.id);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        eyebrow="The 1600 Project"
        title="SAT practice log"
        description="A tracker for your official SAT practice. Log a practice test you took (for example in Bluebook) from your score report: your scores, and the numbers of the questions you missed, skipped or guessed. No questions are copied here."
        actions={
          <>
            <ButtonLink href="/practice-tests/new" size="sm">Log a test</ButtonLink>
          </>
        }
      />
      {attempts.length === 0 ? (
        <EmptyState title="No tests logged yet" action={<ButtonLink href="/practice-tests/new">Log your first test</ButtonLink>}>
          After a practice test, open your score report and log it here. It takes a few minutes, even on a phone.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {attempts.map((a) => (
            <li key={a.id}>
              <Link href={`/practice-tests/${a.id}`}>
                <Card className="flex flex-wrap items-center gap-3 hover:bg-surface-2">
                  <span className="flex-1">
                    <span className="block font-semibold">{a.test.name}</span>
                    <span className="text-sm text-muted">
                      {formatInZone(a.dateTaken, "UTC", "medium")} · {a._count.items} missed, skipped or guessed{a._count.comments ? ` · ${a._count.comments} comment${a._count.comments === 1 ? "" : "s"} from your tutor` : ""}
                    </span>
                  </span>
                  <span className="score-num text-2xl">{a.total ?? "–"}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", a.status === "complete" ? "bg-success-bg text-success" : "bg-warning-bg text-warning")}>{a.status === "complete" ? "Complete" : "Draft"}</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
