import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { DeleteSessionButton, SessionForm } from "@/components/classes/cohort-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { attendanceVsGains, listSessions } from "@/server/cohort";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Attendance" };

const when = (d: Date, zone: string) => formatInZone(d, zone, "full");
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

/** Sessions, taking attendance, and attendance next to score gains. */
export default async function AttendancePage({ params, searchParams }: PageProps<"/teach/[classId]/attendance">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { classId } = await params;
  const { before } = await searchParams;
  let c, s, gains;
  try {
    [c, s, gains] = await Promise.all([getClassForTeacher(user.id, classId), listSessions(user.id, classId, { before: typeof before === "string" ? before : undefined }), attendanceVsGains(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { upcoming, past } = s;
  const groupName = new Map(s.groups.map((g) => [g.id, g.name]));
  const visibleGroups = s.access.groupIds.length ? s.groups.filter((g) => s.access.groupIds.includes(g.id)) : s.groups;
  const row = (x: (typeof s.sessions)[number]) => (
    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <Link href={`/teach/${classId}/attendance/${x.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
        {when(x.startsAt, zone)}
        {x.title && ` · ${x.title}`}
      </Link>
      <span className="flex items-center gap-2 text-muted">
        {x.groupId ? groupName.get(x.groupId) : "Whole class"} · {x._count.attendance} marked
        {s.access.role !== "VIEWER" && <DeleteSessionButton classId={classId} sessionId={x.id} />}
      </span>
    </li>
  );
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="attendance" />
      {s.access.role !== "VIEWER" && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Add sessions</h2>
          <SessionForm classId={classId} groups={visibleGroups.map((g) => ({ id: g.id, name: g.name }))} mustPickGroup={s.access.groupIds.length > 0} />
        </Card>
      )}
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Upcoming</h2>
        {upcoming.length ? <ul className="flex flex-col divide-y divide-border">{upcoming.map(row)}</ul> : <p className="text-sm text-muted">No sessions coming up.</p>}
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Past sessions</h2>
        {past.length ? <ul className="flex flex-col divide-y divide-border">{past.map(row)}</ul> : <p className="text-sm text-muted">None yet.</p>}
        <div className="mt-3 flex justify-between text-sm">
          {before ? <Link href={`/teach/${classId}/attendance`} className="text-primary underline">Newest</Link> : <span />}
          {s.olderCursor && <Link href={`/teach/${classId}/attendance?before=${s.olderCursor}`} className="text-primary underline">Older sessions</Link>}
        </div>
      </Card>
      {gains.length === 0 ? (
        <EmptyState title="No students yet">Attendance and score gains appear here once students join.</EmptyState>
      ) : (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Attendance and score gains</h2>
          <p className="mb-3 text-sm text-muted">Side by side for each student. This shows a pattern, not cause and effect: many things affect a student&apos;s score.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Each student&apos;s attendance rate and score gain</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Student</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Attended</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th scope="col" className="py-2 text-right font-medium">Gain since baseline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {gains.map((g) => (
                  <tr key={g.id}>
                    <th scope="row" className="py-2 pr-3 font-medium">{g.name}</th>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {g.attended}/{g.sessions}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct(g.rate)}</td>
                    <td className="py-2 text-right tabular-nums">{g.gain === null ? "–" : g.gain >= 0 ? `+${g.gain}` : g.gain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
