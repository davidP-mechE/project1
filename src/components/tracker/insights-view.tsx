import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { TrendChart } from "@/components/charts/trend-chart";
import type { studentInsights } from "@/server/insights";

type Insights = Awaited<ReturnType<typeof studentInsights>>;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The insights dashboard (student's own, or a tutor's view of a student in their class). */
export function InsightsView({ data, who = "you" }: { data: Insights; who?: "you" | "student" }) {
  const ids = data.trend.map((t) => t.id);
  const labels = data.trend.map((t) => short(t.date));
  const official = data.bySkill.filter((r) => r.misses > 0);
  const practised = data.bySkill.filter((r) => r.practiceAnswered > 0);
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Focus next</h2>
        {data.focus.length === 0 ? (
          <p className="text-sm text-muted">Finish a logged test with tagged misses to see what to work on.</p>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-3">
            {data.focus.map((f, i) => (
              <li key={f.skillId} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                <span className="text-xs text-muted">#{i + 1} · {f.misses} miss{f.misses === 1 ? "" : "es"} in the last 3 tests</span>
                <span className="font-semibold">{f.name}</span>
                {f.set ? (
                  <Link href={`/practice/${f.set.id}`} className="text-sm underline">
                    Practise: {f.set.title}
                  </Link>
                ) : (
                  <span className="text-sm text-muted">No published practice set for this skill yet.</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Score trend</h2>
        <TrendChart
          title="Scores on logged practice tests"
          months={ids}
          labels={labels}
          domain={[200, 1600]}
          empty={`No finished logs yet${who === "you" ? ": log a practice test to start your trend" : ""}.`}
          series={[
            { name: "Total", values: data.trend.map((t) => t.total) },
            { name: "Reading and Writing", values: data.trend.map((t) => t.rw) },
            { name: "Math", values: data.trend.map((t) => t.math) },
          ]}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Misses by skill</h2>
        <p className="text-sm text-muted">Official practice: questions missed, skipped or guessed on {data.totals.logs} logged test{data.totals.logs === 1 ? "" : "s"} ({data.totals.misses} in all). Coursebook practice: answers in practice sets.</p>
        {official.length === 0 && practised.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Misses by skill</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 pr-3">Skill</th>
                  <th scope="col" className="py-2 pr-3 text-right">Official misses</th>
                  <th scope="col" className="py-2 pr-3 text-right">Careless</th>
                  <th scope="col" className="py-2 pr-3 text-right">Concept gap</th>
                  <th scope="col" className="py-2 text-right">Coursebook practice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.bySkill.map((r) => (
                  <tr key={r.skillId}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {r.name}
                      <span className="block text-xs text-muted">{r.domain}</span>
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{r.misses}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.misses ? pct(r.carelessShare) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.misses ? pct(r.conceptShare) : "–"}</td>
                    <td className="py-2 text-right tabular-nums">{r.practiceAnswered ? `${r.practiceAnswered - r.practiceWrong}/${r.practiceAnswered} right` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Error types over time</h2>
        <TrendChart
          title="Misses by error type on each logged test"
          months={ids}
          labels={labels}
          empty="No finished logs yet."
          series={data.errorTypes.map((e) => ({ name: e.label, values: data.errorTrend.map((t) => t.counts[e.id] ?? 0) }))}
        />
      </Card>
    </div>
  );
}
