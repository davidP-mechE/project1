import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { requireUser } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classHeatmap } from "@/server/tutor-view";

export const metadata: Metadata = { title: "SAT practice" };

/** Students × skills, shaded by misses per test over each student's last 3 logged practice tests. */
export default async function PracticeHeatmapPage({ params }: PageProps<"/teach/[classId]/practice">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, h;
  try {
    [c, h] = await Promise.all([getClassForTeacher(user.id, classId), classHeatmap(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const shade = (rate: number) => (h.max ? 0.12 + 0.78 * (rate / h.max) : 0);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="practice" />
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Misses by skill (last 3 logged tests)</h2>
        <p className="text-sm text-muted">Each cell is the average number of questions on that skill missed, skipped or guessed per test, over the student&apos;s last 3 finished logs. Darker means more. A dash means no finished logs yet.</p>
        {h.skills.length === 0 ? (
          <EmptyState title="No logged misses yet">When students log official practice tests and tag their misses, the heatmap fills in.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1 text-xs">
              <caption className="sr-only">Average misses per test by student and skill</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-surface text-left">Student</th>
                  {h.skills.map((s) => (
                    <th key={s.id} scope="col" className="h-32 w-10 align-bottom font-medium">
                      <span className="inline-block max-h-32 overflow-hidden whitespace-nowrap [writing-mode:vertical-rl] rotate-180" title={`${s.domain}: ${s.name}`}>
                        {s.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h.students.map((st) => (
                  <tr key={st.id}>
                    <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface pr-2 text-left font-normal">
                      <Link href={`/teach/${classId}/students/${st.id}/practice`} className="underline-offset-2 hover:underline">
                        {st.name}
                      </Link>
                      <span className="block text-[0.7rem] text-muted">{st.tests} test{st.tests === 1 ? "" : "s"}</span>
                    </th>
                    {h.skills.map((s) => {
                      const cell = h.cells[`${st.id}:${s.id}`];
                      return (
                        <td
                          key={s.id}
                          className="h-10 w-10 rounded text-center tabular-nums"
                          style={cell ? { background: `color-mix(in oklab, var(--danger) ${Math.round(shade(cell.rate) * 100)}%, var(--surface))`, color: shade(cell.rate) > 0.55 ? "white" : undefined } : undefined}
                          title={cell ? `${st.name}, ${s.name}: ${cell.misses} missed over ${cell.tests} test${cell.tests === 1 ? "" : "s"}` : `${st.name}: no finished logs`}
                        >
                          {cell ? (cell.rate ? cell.rate.toFixed(1).replace(/\.0$/, "") : "0") : "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
