import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintBar } from "@/components/reports/print-bar";
import { ProgramBadge } from "@/components/brand/seal";
import { classSummaryReport } from "@/server/reports";
import { NotFoundError } from "@/server/courses";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Class summary" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-300 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="score-num text-2xl">{value}</p>
    </div>
  );
}

const signed = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}`);

/** A class summary for paper: numbers, the score spread, accuracy by area and attendance. */
export default async function ClassSummaryPage({ params }: PageProps<"/print/class/[classId]">) {
  const user = await requireUser();
  const { classId } = await params;
  let r;
  try {
    r = await classSummaryReport(user.id, classId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const zone = await viewerZone();
  const maxBin = Math.max(1, ...r.stats.distribution.map((b) => b.count));
  return (
    <div className="print-doc">
      <PrintBar back={`/teach/${classId}/scores`} label="Class summary" />
      <article className="mx-auto flex max-w-[46rem] flex-col gap-8 px-6 pb-16">
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-5">
          <div>
            <p className="text-sm text-neutral-500">Class summary</p>
            <h1 className="mt-1 font-display text-4xl font-bold">{r.className}</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {r.program.name} · printed {formatInZone(new Date(), zone, "long")}
              {r.scoped && " · your groups and subjects only"}
            </p>
          </div>
          <ProgramBadge program={r.program} className="size-16" />
        </header>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Students" value={String(r.stats.students)} />
          <Stat label="Average baseline" value={r.stats.averageBaseline?.toString() ?? "–"} />
          <Stat label="Average latest" value={r.stats.averageLatest?.toString() ?? "–"} />
          <Stat label="Average gain" value={signed(r.stats.averageGain)} />
        </section>
        <p className="-mt-4 text-sm text-neutral-600">
          {r.stats.onTrack} on track · {r.stats.missingBaseline} without a baseline · median gain {signed(r.stats.medianGain)}
          {r.stats.byTarget.map((t) => ` · ${t.reached} at ${t.target}+`).join("")}
        </p>
        <section>
          <h2 className="mb-2 text-xl font-semibold">Latest scores</h2>
          <table className="w-full text-sm">
            <caption className="sr-only">Number of students by latest score</caption>
            <tbody>
              {r.stats.distribution
                .filter((b) => b.from >= 600)
                .map((b) => (
                  <tr key={b.from}>
                    <th scope="row" className="w-28 py-0.5 pr-3 text-left font-normal tabular-nums">
                      {b.from}–{b.from + 99}
                    </th>
                    <td className="py-0.5">
                      <div className="flex items-center gap-2">
                        <div className="h-3 rounded-sm bg-[#14213d]" style={{ width: `${(b.count / maxBin) * 80}%` }} />
                        <span className="tabular-nums">{b.count}</span>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-2 text-xl font-semibold">By area (last 90 days)</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-neutral-500">
              <tr>
                <th scope="col" className="py-1 font-medium">Area</th>
                <th scope="col" className="py-1 text-right font-medium">Right</th>
                <th scope="col" className="py-1 text-right font-medium">Answers</th>
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
        </section>
        <section>
          <h2 className="mb-2 text-xl font-semibold">Attendance</h2>
          <p className="text-sm">{r.attendance.marked ? `${Math.round((r.attendance.attended / r.attendance.marked) * 100)}% of marked sessions attended (${r.attendance.attended} of ${r.attendance.marked}).` : "No sessions marked yet."}</p>
        </section>
        {r.students && r.students.length > 0 && (
          <section className="break-before-page">
            <h2 className="mb-2 text-xl font-semibold">Students</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th scope="col" className="py-1 font-medium">Student</th>
                  <th scope="col" className="py-1 text-right font-medium">Baseline</th>
                  <th scope="col" className="py-1 text-right font-medium">Latest</th>
                  <th scope="col" className="py-1 text-right font-medium">Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {r.students.map((s) => (
                  <tr key={s.id}>
                    <th scope="row" className="py-1 font-normal">{s.name}</th>
                    <td className="py-1 text-right tabular-nums">{s.baseline ?? "–"}</td>
                    <td className="py-1 text-right tabular-nums">{s.latest ?? "–"}</td>
                    <td className="py-1 text-right tabular-nums">{s.baseline !== null && s.latest !== null ? signed(s.latest - s.baseline) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-neutral-500">Alphabetical. For the class&apos;s staff only: don&apos;t share it with students.</p>
          </section>
        )}
      </article>
    </div>
  );
}
