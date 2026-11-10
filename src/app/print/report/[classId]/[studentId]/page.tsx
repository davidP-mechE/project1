import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintBar } from "@/components/reports/print-bar";
import { StudentReport } from "@/components/reports/student-report";
import { staffProgressReport } from "@/server/reports";
import { NotFoundError } from "@/server/courses";
import { db } from "@/server/db";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Progress report" };

/** A student's progress report for staff whose scope includes them. */
export default async function StaffReportPage({ params }: PageProps<"/print/report/[classId]/[studentId]">) {
  const user = await requireUser();
  const { classId, studentId } = await params;
  let r;
  try {
    r = await staffProgressReport(user.id, classId, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const [zone, c] = await Promise.all([viewerZone(), db.class.findUniqueOrThrow({ where: { id: classId }, select: { program: { select: { targets: true } } } })]);
  return (
    <div className="print-doc">
      <PrintBar back={`/teach/${classId}/students/${studentId}`} label="Progress report" />
      <StudentReport r={r} zone={zone} targets={c.program.targets} />
    </div>
  );
}
