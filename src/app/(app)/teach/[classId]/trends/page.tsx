import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { TrendChart } from "@/components/charts/trend-chart";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classTrends } from "@/server/trends";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Trends" };

const METRIC = { total: "Average total score", math: "Average Math score", rw: "Average Reading and Writing score" } as const;

/** Groups and domains over the last 12 months, inside the viewer's scope. */
export default async function TrendsPage({ params }: PageProps<"/teach/[classId]/trends">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, t;
  try {
    [c, t] = await Promise.all([getClassForTeacher(user.id, classId), classTrends(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="trends" />
      <Card>
        <h2 className="text-lg font-semibold">Groups over time</h2>
        <p className="mb-4 text-sm text-muted">{METRIC[t.metric]} by month, from every score added that month{t.access.groupIds.length ? ", for your groups" : ""}.</p>
        <TrendChart title={`${METRIC[t.metric]} by group and month`} months={t.months} series={t.groups} />
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Domains over time</h2>
        <p className="mb-4 text-sm text-muted">Share of questions answered correctly, by month: assignments, diagnostics and College Board questions{t.access.subjects ? ", in the subjects you cover" : ""}.</p>
        <TrendChart title="Accuracy by domain and month" months={t.months} series={t.domains} unit="%" domain={[0, 100]} />
      </Card>
    </div>
  );
}
