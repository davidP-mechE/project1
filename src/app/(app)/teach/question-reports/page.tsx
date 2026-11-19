import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Markdown } from "@/components/lesson/markdown";
import { QueueActions } from "@/components/question-quality/queue-actions";
import { REASON_TEXT, reportQueue } from "@/server/question-reports";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Question reports" };

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const RESOLUTION: Record<string, string> = { FIXED: "Fixed", NO_CHANGE: "No change needed", UNPUBLISHED: "Unpublished" };

/** Questions students reported: bank questions for authors, and questions on your own worksheets. */
export default async function QuestionReportsPage({ searchParams }: PageProps<"/teach/question-reports">) {
  const user = await requireUser();
  const resolved = (await searchParams).resolved === "1";
  const [groups, zone] = await Promise.all([reportQueue(user.id, { resolved }), viewerZone()]);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Question reports" description="Questions students flagged: a wrong answer key, a typo, something confusing or a missing figure. Grouped by question, most reported first. Reports don't show who sent them." />
      <nav aria-label="Report status" className="flex gap-3 text-sm">
        <Link href="/teach/question-reports" aria-current={!resolved ? "page" : undefined} className={!resolved ? "font-semibold" : "text-primary underline"}>Open</Link>
        <Link href="/teach/question-reports?resolved=1" aria-current={resolved ? "page" : undefined} className={resolved ? "font-semibold" : "text-primary underline"}>Resolved</Link>
      </nav>
      {groups.length === 0 ? (
        <EmptyState title={resolved ? "Nothing resolved yet" : "No open reports"}>{resolved ? "Reports you resolve appear here." : "When a student reports a question you're responsible for, it shows here and you get a notice."}</EmptyState>
      ) : (
        groups.map((g) => {
          const counts = new Map<string, number>();
          for (const r of g.reports) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
          return (
            <Card key={g.key} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold">{g.title}</h2>
                {g.version !== null && <span className="text-sm text-muted">Version {g.version}{g.published === false ? " · unpublished" : ""}</span>}
                <span className="text-sm font-semibold">
                  {g.reports.length} report{g.reports.length === 1 ? "" : "s"}: {[...counts.entries()].map(([r, n]) => `${REASON_TEXT[r as keyof typeof REASON_TEXT]}${n > 1 ? ` ×${n}` : ""}`).join(", ")}
                </span>
              </div>
              <div className="rounded-md bg-surface-2 p-3 text-sm">
                <Markdown>{g.stem}</Markdown>
                {g.choices.length > 0 && (
                  <ol className="mt-2 flex flex-col gap-1">
                    {g.choices.map((c, n) => (
                      <li key={n} className={LETTERS[n] === g.answer ? "font-semibold text-success" : ""}>
                        {LETTERS[n]}. {c}
                        {LETTERS[n] === g.answer ? " (the key)" : ""}
                      </li>
                    ))}
                  </ol>
                )}
                {!g.choices.length && <p className="mt-2">Answer key: <strong>{g.answer}</strong></p>}
              </div>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {g.reports.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
                    <span className="font-medium">{REASON_TEXT[r.reason]}</span>
                    <span className="text-muted">{formatInZone(r.createdAt, zone, "full")}</span>
                    {r.version !== null && r.version !== g.version && <span className="text-muted">(on version {r.version})</span>}
                    <span>Their answer: <strong>{r.answerGiven ?? "none yet"}</strong></span>
                    {r.resolution && <span className="text-muted">{RESOLUTION[r.resolution] ?? r.resolution}</span>}
                    {r.note && <span className="basis-full text-muted">“{r.note}”</span>}
                  </li>
                ))}
              </ul>
              {!resolved && <QueueActions reportKey={g.key} editHref={g.editHref} canUnpublish={g.canUnpublish} />}
            </Card>
          );
        })
      )}
    </div>
  );
}
