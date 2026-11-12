import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { NewLog } from "@/components/tracker/new-log";
import { requireUser } from "@/server/session";
import { listTests } from "@/server/tracker";

export const metadata: Metadata = { title: "Log a practice test" };

export default async function NewLogPage({ searchParams }: PageProps<"/practice-tests/new">) {
  const user = await requireUser();
  const t = (await searchParams).test;
  const tests = await listTests(user.id);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/practice-tests" className="text-muted hover:underline">← SAT practice log</Link>
      </p>
      <PageHeader title="Log a practice test" description="Which test, and when you took it. Next you'll mark the questions you missed from your score report." />
      <Card>
        <NewLog tests={tests.map((x) => ({ id: x.id, name: x.name, shared: x.shared }))} today={new Date().toISOString().slice(0, 10)} presetTestId={typeof t === "string" ? t : null} />
      </Card>
    </div>
  );
}
