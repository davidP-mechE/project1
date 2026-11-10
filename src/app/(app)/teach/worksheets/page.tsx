import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { WorksheetUpload } from "@/components/classes/worksheet-upload";
import { cn } from "@/lib/utils";
import { listWorksheets } from "@/server/worksheets";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Worksheets" };

const STATUS = { READING: "Reading…", READY: "Ready", FAILED: "Couldn't read", UPLOADING: "Uploading" } as const;

/** The teacher's worksheets: upload a PDF, Claude lists its questions, then assign them. */
export default async function WorksheetsPage() {
  const user = await requireUser();
  const worksheets = await listWorksheets(user.id);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/teach" className="text-muted hover:text-text hover:underline">
          ← My classes
        </Link>
      </p>
      <PageHeader title="Worksheets" description="Upload a PDF of questions. Claude lists each question with its answer; you check them, then assign some or all of them to your classes." />
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Upload a worksheet</h2>
        <WorksheetUpload />
      </Card>
      {worksheets.length === 0 ? (
        <EmptyState title="No worksheets yet">Upload one above to turn it into questions students answer in the app.</EmptyState>
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {worksheets.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <Link href={`/teach/worksheets/${w.id}`} className="font-medium hover:underline">
                  {w.title}
                </Link>
                <span className="flex items-center gap-3 text-xs text-muted">
                  {w.status === "READY" && (
                    <span>
                      {w._count.items} questions · used in {w._count.assignments} {w._count.assignments === 1 ? "assignment" : "assignments"}
                    </span>
                  )}
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", w.status === "READY" ? "bg-success-bg text-success" : w.status === "FAILED" ? "bg-danger-bg text-danger" : "bg-surface-2")}>{STATUS[w.status]}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
