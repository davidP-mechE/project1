import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { MistakeReview, type Practice } from "@/components/sat/mistake-review";
import { myMistakes, practiceFor } from "@/server/mistakes";
import { domainName } from "@/lib/sat/domains";
import { env } from "@/server/env";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Mistake log" };

/** Every SAT question the student got wrong comes back here until they get it right twice in a row. */
export default async function MistakesPage() {
  const user = await requireUser();
  const zone = await viewerZone();
  const m = await myMistakes(user.id);
  const next = m.due[0] ? await practiceFor(user.id, m.due[0].id) : null;
  let practice: Practice | null = null;
  if (next) {
    const base = { mistakeId: next.mistake.id, label: next.mistake.label, domain: domainName(next.mistake.domain) };
    practice =
      next.kind === "question" ? { kind: "question", ...base, question: next.question! } : next.kind === "external" ? { kind: "external", ...base, url: next.url!, questionId: next.questionId! } : { kind: "self", ...base };
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Mistake log"
        description={`${m.due.length} to review now · ${m.upcoming.length} coming up · ${m.retired} cleared`}
      />
      {m.total === 0 ? (
        <EmptyState title="No mistakes yet">When you get an SAT question wrong in an assignment, a diagnostic or a practice test, it comes back here to practise until you&apos;ve got it.</EmptyState>
      ) : practice ? (
        <MistakeReview key={practice.mistakeId} zone={zone} p={practice} desmosKey={env.DESMOS_API_KEY ?? null} />
      ) : (
        <EmptyState title="All caught up">Nothing to review right now. {m.upcoming[0] ? `The next one is due ${m.upcoming[0].due.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}.` : "Every mistake is cleared!"}</EmptyState>
      )}
      {m.byDomain.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Open mistakes by topic</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {m.byDomain.map((d) => (
              <li key={d.domain} className="flex justify-between py-2">
                <span>{d.name}</span>
                <span className="tabular-nums text-muted">{d.open}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
