import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/server/session";
import { practiceCatalog } from "@/server/bank";

export const metadata: Metadata = { title: "Practice sets" };

/** Published practice sets (original Coursebook questions). Sets assigned in a class are on the Classes page. */
export default async function PracticePage() {
  const user = await requireUser();
  const sets = await practiceCatalog(user.id);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader eyebrow="The 1600 Project" title="Practice sets" description="Original SAT-style questions written for Coursebook, with instant feedback. Sets your class assigns are on the Classes page." />
      {sets.length === 0 ? (
        <EmptyState title="No practice sets yet">New sets appear here when they&apos;re published.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sets.map((s) => (
            <Link key={s.id} href={`/practice/${s.id}`} className="block">
              <Card className="h-full hover:bg-surface-2">
                <p className="font-semibold">{s.title}</p>
                <p className="text-sm text-muted">
                  {s.count} question{s.count === 1 ? "" : "s"}
                  {s.timeLimitMin ? ` · ${s.timeLimitMin} min when timed` : ""}
                  {s.status === "draft" ? " · draft (only authors see this)" : ""}
                </p>
                {s.description && <p className="mt-1 text-sm">{s.description}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
