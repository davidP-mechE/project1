import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { BuildNowButton, WeeklyBatch } from "@/components/practice-tools/weekly-batch";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { autoBatchView } from "@/server/auto-practice";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Weekly practice" };

const weekLabel = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A local datetime-local value a week from now, in the viewer's zone, at 9pm. */
function defaultDue(zone: string) {
  const d = new Date(Date.now() + 7 * 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${day}T21:00`;
}

/** Weekly auto-assigned practice: review each student's proposed set, then approve them all. */
export default async function WeeklyPracticePage({ params, searchParams }: PageProps<"/teach/[classId]/weekly">) {
  const user = await requireUser();
  const { classId } = await params;
  const { week } = await searchParams;
  let c, v;
  try {
    [c, v] = await Promise.all([getClassForTeacher(user.id, classId), autoBatchView(user.id, classId, { week: typeof week === "string" ? week : undefined })]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const zone = await viewerZone();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="weekly" />
      <Card className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Weekly practice · week of {weekLabel(v.week)}</h1>
        <p className="text-sm text-muted">
          Every week each student gets a proposed set of 8–12 published questions from the question bank, aimed at their weakest skills (from their practice, the error log and the mistake log), leaving out questions they got right recently. Built by rules, not AI, so it works for every student. Remove or swap questions, take a student out, then approve all: each set becomes that student&apos;s own assignment.
        </p>
        {v.batch && <p className="text-xs text-muted">Built {formatInZone(v.batch.createdAt, zone, "full")}.</p>}
        {v.canBuild && <BuildNowButton classId={classId} hasBatch={Boolean(v.batch)} />}
        {v.weeks.length > 1 && (
          <nav aria-label="Other weeks" className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted">Other weeks:</span>
            {v.weeks.map((w) => (
              <Link key={w} href={`/teach/${classId}/weekly?week=${w}`} aria-current={w === v.week ? "page" : undefined} className={w === v.week ? "font-semibold" : "text-primary underline-offset-2 hover:underline"}>
                {weekLabel(w)}
              </Link>
            ))}
          </nav>
        )}
      </Card>
      {!v.batch ? (
        <EmptyState title="No sets for this week yet">The worker builds them automatically each week. You can also build them now.</EmptyState>
      ) : v.items.length === 0 ? (
        <EmptyState title="No sets for your students">None of your students had enough practice data, or published questions on their weak skills, this week.</EmptyState>
      ) : (
        <WeeklyBatch classId={classId} batchId={v.batch.id} items={v.items} defaultDue={defaultDue(zone)} />
      )}
      {v.skipped.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Left out this week</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {v.skipped.map((s) => (
              <li key={s.studentId} className="py-2">
                <span className="font-medium">{s.name}</span>: <span className="text-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
