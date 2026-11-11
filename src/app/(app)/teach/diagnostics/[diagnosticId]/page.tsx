import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { Markdown } from "@/components/lesson/markdown";
import { PublishDiagnosticButtons } from "@/components/sat/diagnostic-forms";
import { NotFoundError } from "@/server/courses";
import { getDiagnostic } from "@/server/diagnostics";
import { domainName, sectionName } from "@/lib/sat/domains";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Diagnostic" };

const STAGE: Record<string, string> = { M1: "Module 1", M2_HARD: "Module 2 (harder)", M2_EASY: "Module 2 (easier)" };

export default async function DiagnosticPage({ params }: PageProps<"/teach/diagnostics/[diagnosticId]">) {
  const user = await requireUser();
  const { diagnosticId } = await params;
  let d;
  try {
    d = await getDiagnostic(user.id, diagnosticId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/teach/diagnostics" className="text-muted hover:text-text hover:underline">
          ← Diagnostics
        </Link>
      </p>
      <PageHeader title={d.diagnostic.title} description={d.diagnostic.status === "PUBLISHED" ? "Published: assign it from a class's Assign tab." : "Draft: check the questions, then publish."} actions={<PublishDiagnosticButtons diagnosticId={d.diagnostic.id} published={d.diagnostic.status === "PUBLISHED"} assigned={d.assigned} />} />
      {d.coverageGaps.length > 0 && <Alert tone="warning">Module 1 has no questions on: {d.coverageGaps.map((g) => domainName(g)).join(", ")}. Tag more worksheet questions in those domains for a fuller picture.</Alert>}
      {d.modules.map((m) => (
        <Card key={m.id}>
          <h2 className="mb-1 text-lg font-semibold">
            {sectionName(m.section)}: {STAGE[m.stage]}
          </h2>
          <p className="mb-3 text-sm text-muted">
            {m.items.length} questions · {Math.round(m.timeLimitSec / 60)} minutes{m.stage === "M1" && ` · ${m.routeThreshold}+ right goes to the harder module 2`}
          </p>
          <ol className="flex flex-col divide-y divide-border text-sm">
            {m.items.map((i, n) => (
              <li key={i.id} className="flex flex-col gap-1 py-2">
                <span className="text-xs text-muted">
                  {n + 1}. {domainName(i.domain)}
                  {i.skill && ` · ${i.skill}`} · {i.difficulty?.toLowerCase() ?? "no difficulty"} · from {i.worksheet.title} #{i.label}
                </span>
                <Markdown className="line-clamp-3 text-sm [&_p]:m-0">{i.prompt}</Markdown>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
