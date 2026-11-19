import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { JoinLiveForm } from "@/components/practice-tools/live";
import { KIND_LABEL, openRunsFor } from "@/server/live";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Join a live warm-up" };

/** Students: join a live warm-up or exit ticket by code, or from the list of open ones. */
export default async function JoinLivePage() {
  const user = await requireUser();
  const runs = await openRunsFor(user.id);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title="Join a live warm-up" description="Your tutor shows a six-character code. Type it here, or pick a run that's open in your class." />
      <Card>
        <JoinLiveForm />
      </Card>
      {runs.length === 0 ? (
        <EmptyState title="Nothing live right now">When a tutor starts a warm-up or exit ticket in one of your classes, it shows here and on Today.</EmptyState>
      ) : (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Open now</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/live/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{KIND_LABEL[r.kind]}: {r.title}</Link> <span className="text-muted">· {r.className}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
