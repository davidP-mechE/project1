import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { BuildDiagnosticForm } from "@/components/sat/diagnostic-forms";
import { listDiagnostics } from "@/server/diagnostics";
import { sectionName } from "@/lib/sat/domains";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Diagnostics" };

/** Adaptive SAT-style diagnostics built from the program's tagged questions. */
export default async function DiagnosticsPage() {
  const user = await requireUser();
  const { programs, diagnostics } = await listDiagnostics(user.id);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title="Diagnostics" description="Timed, two-module tests like the digital SAT: module 2 is harder or easier depending on module 1. Scores are estimates." />
      {programs.length === 0 ? (
        <EmptyState title="No program yet">Create a class first; diagnostics belong to your tutoring program.</EmptyState>
      ) : (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Build a diagnostic</h2>
          <BuildDiagnosticForm programs={programs} />
        </Card>
      )}
      {diagnostics.length > 0 && (
        <ul className="flex flex-col gap-3">
          {diagnostics.map((d) => {
            const sections = [...new Set(d.modules.map((m) => m.section))];
            return (
              <li key={d.id}>
                <Link href={`/teach/diagnostics/${d.id}`} className="card-hover block rounded-2xl border border-border bg-surface p-4">
                  <span className="font-semibold">{d.title}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {sections.map((s) => sectionName(s)).join(" + ")} · {d.status === "PUBLISHED" ? "Published" : "Draft"} · assigned {d._count.assignments} {d._count.assignments === 1 ? "time" : "times"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
