import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { AlertActions } from "@/components/classes/cohort-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classAlerts, type AlertKind } from "@/server/cohort";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Alerts" };

const KIND: Record<AlertKind, { label: string; tone: string }> = {
  MISSING_WORK: { label: "Missing work", tone: "bg-warning-bg text-warning" },
  DROPPING: { label: "Scores dropping", tone: "bg-danger-bg text-danger" },
  INACTIVE: { label: "Inactive", tone: "bg-surface-2 text-text" },
  ABSENCES: { label: "Absences", tone: "bg-danger-bg text-danger" },
};

/** Students who may need a nudge, worked out from the class's latest data. */
export default async function AlertsPage({ params }: PageProps<"/teach/[classId]/alerts">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, a;
  try {
    [c, a] = await Promise.all([getClassForTeacher(user.id, classId), classAlerts(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="alerts" />
      {a.alerts.length === 0 ? (
        <EmptyState title="No alerts">Nobody is behind, inactive, missing sessions or dropping right now.{a.hiddenCount > 0 && ` (${a.hiddenCount} snoozed or dismissed.)`}</EmptyState>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-muted">Worked out from the latest data each time you open this. Get them by email each morning in Settings → Notifications.</p>
          <ul className="flex flex-col divide-y divide-border">
            {a.alerts.map((x) => (
              <li key={`${x.studentId}:${x.kind}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND[x.kind].tone}`}>{KIND[x.kind].label}</span>
                  <Link href={`/teach/${classId}/students/${x.studentId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {x.name}
                  </Link>
                  <span className="text-muted">{x.detail}</span>
                </span>
                {a.access.role !== "VIEWER" && <AlertActions classId={classId} studentId={x.studentId} kind={x.kind} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
