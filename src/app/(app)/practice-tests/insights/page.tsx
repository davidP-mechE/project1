import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { InsightsView } from "@/components/tracker/insights-view";
import { requireUser } from "@/server/session";
import { studentInsights } from "@/server/insights";

export const metadata: Metadata = { title: "SAT practice insights" };

export default async function InsightsPage() {
  const user = await requireUser();
  const data = await studentInsights(user.id);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/practice-tests" className="text-muted hover:underline">← SAT practice log</Link>
      </p>
      <PageHeader title="Insights" description="From your finished practice-test logs (official practice) and your practice sets here (Coursebook practice)." actions={<ButtonLink href="/practice-tests/redo" size="sm" variant="secondary">Redo list</ButtonLink>} />
      <InsightsView data={data} />
    </div>
  );
}
