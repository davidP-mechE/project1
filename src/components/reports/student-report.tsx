import { ProgramBadge } from "@/components/brand/seal";
import { ScoreChart, ScoreTable } from "@/components/scores/score-chart";
import { PlanView } from "@/components/sat/plan-view";
import { formatInZone } from "@/lib/dates";
import type { myProgressReport } from "@/server/reports";

type Report = Awaited<ReturnType<typeof myProgressReport>>;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-300 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="score-num text-2xl">{value}</p>
    </div>
  );
}

/** One student's progress report, laid out for paper. */
export function StudentReport({ r, zone, targets }: { r: Report; zone: string; targets: number[] }) {
  const h = r.history;
  const gain = h.baseline && h.latest ? h.latest.total - h.baseline.total : null;
  const goal = h.target ?? targets.at(-1) ?? null;
  return (
    <article className="mx-auto flex max-w-[46rem] flex-col gap-8 px-6 pb-16">
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-5">
        <div>
          <p className="text-sm text-neutral-500">Progress report</p>
          <h1 className="mt-1 font-display text-4xl font-bold">{r.studentName || "Student"}</h1>
          {r.context.length > 0 && <p className="mt-1 text-sm text-neutral-600">{r.context.join("; ")}</p>}
          <p className="text-sm text-neutral-600">Printed {formatInZone(new Date(), zone, "long")}</p>
        </div>
        {r.programs[0] && <ProgramBadge program={r.programs[0]} className="size-16" />}
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Baseline" value={h.baseline ? String(h.baseline.total) : "–"} />
        <Stat label="Latest" value={h.latest ? String(h.latest.total) : "–"} />
        <Stat label="Gain" value={gain === null ? "–" : `${gain > 0 ? "+" : ""}${gain}`} />
        <Stat label="Estimated now" value={h.projection ? `${h.projection.low}–${h.projection.high}` : "–"} />
      </section>
      {goal && <p className="-mt-4 text-sm text-neutral-600">Goal: {goal}{h.testDate ? ` · SAT on ${formatInZone(h.testDate, "UTC", "medium")}` : ""}. Estimates are not official scores.</p>}

      {h.scores.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl font-semibold">Score history</h2>
          <ScoreChart points={h.scores} targets={goal ? [goal] : []} projection={h.projection} />
          <div className="mt-3">
            <ScoreTable scores={h.scores} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xl font-semibold">By area (last 90 days)</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th scope="col" className="py-1 font-medium">Area</th>
              <th scope="col" className="py-1 text-right font-medium">Right</th>
              <th scope="col" className="py-1 text-right font-medium">Questions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {r.domains.map((d) => (
              <tr key={d.domain}>
                <th scope="row" className="py-1 font-normal">{d.name}</th>
                <td className="py-1 text-right tabular-nums">{d.accuracy === null ? "–" : `${d.accuracy}%`}</td>
                <td className="py-1 text-right tabular-nums">{d.answers}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.subjectsNote && <p className="mt-1 text-xs text-neutral-500">{r.subjectsNote}</p>}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xl font-semibold">Attendance</h2>
          <p className="text-sm">{r.attendance.marked ? `${r.attendance.attended} of ${r.attendance.marked} sessions (${Math.round((r.attendance.attended / r.attendance.marked) * 100)}%)` : "No sessions marked yet."}</p>
        </div>
        <div>
          <h2 className="mb-2 text-xl font-semibold">Mistake log</h2>
          {r.mistakes.length ? (
            <ul className="text-sm">
              {r.mistakes.map((m) => (
                <li key={m.name}>
                  {m.name}: {m.open} to practise
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">Nothing waiting.</p>
          )}
        </div>
      </section>

      {r.badges.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl font-semibold">Badges</h2>
          <p className="text-sm">{r.badges.map((b) => b.label).join(" · ")}</p>
        </section>
      )}

      {r.plan && (
        <section className="break-before-page">
          <h2 className="mb-2 text-xl font-semibold">Plan to test day</h2>
          <PlanView weeks={r.plan.weeks} testDate={r.plan.testDate} />
        </section>
      )}
    </article>
  );
}
