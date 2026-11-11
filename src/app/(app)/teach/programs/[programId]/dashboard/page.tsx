import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { ProgramTag } from "@/components/brand/seal";
import { BarList, TrendChart } from "@/components/charts/trend-chart";
import { programTrends } from "@/server/trends";
import { ScoreStats } from "@/components/scores/stats";
import { NotFoundError } from "@/server/courses";
import { programDashboard } from "@/server/scores";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Program dashboard" };

/** The program admin's view of every student: gain against the +300 goal, who's on track, and who's stalling. */
export default async function ProgramDashboardPage({ params, searchParams }: PageProps<"/teach/programs/[programId]/dashboard">) {
  const user = await requireUser();
  const { programId } = await params;
  const sp = await searchParams;
  const classId = typeof sp.class === "string" ? sp.class : undefined;
  const teacherId = typeof sp.teacher === "string" ? sp.teacher : undefined;
  let d, trends;
  try {
    [d, trends] = await Promise.all([programDashboard(user.id, programId, { classId, teacherId }), programTrends(user.id, programId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/programs/${programId}`} className="text-muted hover:text-text hover:underline">
          ← {d.program.name}
        </Link>
      </p>
      <ProgramTag program={d.program} />
      <PageHeader title="Program dashboard" description={`${d.stats.students} students${classId || teacherId ? " (filtered)" : ""}`} />
      <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Class</span>
          <select name="class" defaultValue={classId ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3">
            <option value="">All classes</option>
            {d.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Teacher</span>
          <select name="teacher" defaultValue={teacherId ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3">
            <option value="">All teachers</option>
            {d.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-xl border border-border bg-surface px-4 font-semibold hover:bg-surface-2">
          Filter
        </button>
      </form>
      <ScoreStats stats={d.stats} />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Average gain by month</h2>
        {d.trend.length === 0 ? (
          <p className="text-sm text-muted">No scores after baselines yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">Month</th>
                <th scope="col" className="py-1 text-right font-medium">Average gain over baseline</th>
                <th scope="col" className="py-1 text-right font-medium">Scores</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.trend.map((t) => (
                <tr key={t.month}>
                  <th scope="row" className="py-1.5 text-left font-normal">{new Date(`${t.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</th>
                  <td className="py-1.5 text-right font-medium tabular-nums">{t.averageGain >= 0 ? `+${t.averageGain}` : t.averageGain}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{t.scores}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Students needing attention first</h2>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {d.students.slice(0, 50).map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium">{s.name}</span>
              <span className="tabular-nums text-muted">
                {s.baseline === null ? (s.baselinePending ? "Diagnostic pending" : "No baseline") : `${s.baseline} → ${s.latest ?? "–"}`}
                {s.projection && ` · estimate ${s.projection.low}–${s.projection.high}`}
                {s.stall.stalled && <span className="ml-2 font-medium text-danger">{s.stall.reason}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Classes over time</h2>
        <p className="mb-4 text-sm text-muted">Average total score by month, from every score added that month.</p>
        <TrendChart title="Average score by class and month" months={trends.months} series={trends.classes} />
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Teachers</h2>
        <p className="mb-4 text-sm text-muted">Average gain (latest score minus baseline) of the students in each teacher&apos;s classes, alphabetical. In brackets: students with at least two scores.</p>
        <BarList title="Average gain by teacher" bars={trends.teachers} unit=" pts" />
      </Card>
    </div>
  );
}
