import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { AttendanceRow } from "@/components/classes/cohort-forms";
import { NotFoundError } from "@/server/courses";
import { sessionRegister } from "@/server/cohort";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Take attendance" };

/** The register for one session: big buttons, made for a phone. */
export default async function RegisterPage({ params }: PageProps<"/teach/[classId]/attendance/[sessionId]">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { classId, sessionId } = await params;
  let r;
  try {
    r = await sessionRegister(user.id, classId, sessionId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <p className="text-sm">
        <Link href={`/teach/${classId}/attendance`} className="text-muted hover:text-text hover:underline">
          ← Attendance
        </Link>
      </p>
      <PageHeader title={r.session.title || "Session"} description={`${formatInZone(r.session.startsAt, zone, "weekday")}, ${formatInZone(r.session.startsAt, zone, "time")}`} />
      {r.students.length === 0 ? (
        <EmptyState title="No students in this session">Students in the session&apos;s group (and in your scope) appear here.</EmptyState>
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {r.students.map((s) => (
              <AttendanceRow key={s.id} classId={classId} sessionId={sessionId} student={{ id: s.id, name: s.name }} initial={s.status} canMark={r.canMark} />
            ))}
          </ul>
          {!r.canMark && <p className="mt-3 text-xs text-muted">Viewers can see attendance but not change it.</p>}
        </Card>
      )}
    </div>
  );
}
