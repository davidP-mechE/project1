import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { AutoSetForm, NewSetForm } from "@/components/bank/set-forms";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { listSets, skillOptions } from "@/server/bank";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Question sets" };

export default async function SetsPage() {
  const user = await requireUser();
  let sets;
  try {
    sets = await listSets(user.id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/bank" className="text-muted hover:underline">← Question bank</Link>
      </p>
      <PageHeader title="Question sets" description="Build a set by hand, or generate one from the bank. Students can play a set once it's published (and public, or assigned to their class)." />
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">New set</h2>
        <NewSetForm />
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Generate a set</h2>
        <AutoSetForm skills={await skillOptions()} />
      </Card>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {sets.map((s) => (
          <li key={s.id}>
            <Link href={`/bank/sets/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="flex-1 font-medium">{s.title}</span>
              <span className="text-xs text-muted">{s.questionIds.length} questions · {s.visibility}</span>
              <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", s.status === "published" ? "bg-success-bg text-success" : "bg-surface-2")}>{s.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
