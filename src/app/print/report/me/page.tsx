import type { Metadata } from "next";
import { PrintBar } from "@/components/reports/print-bar";
import { StudentReport } from "@/components/reports/student-report";
import { myProgressReport } from "@/server/reports";
import { db } from "@/server/db";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "My progress report" };

export default async function MyReportPage() {
  const user = await requireUser();
  const [r, zone, programs] = await Promise.all([
    myProgressReport(user.id),
    viewerZone(),
    db.program.findMany({ where: { classes: { some: { members: { some: { userId: user.id } } } } }, select: { targets: true } }),
  ]);
  return (
    <div className="print-doc">
      <PrintBar back="/scores" label="Your progress report" />
      <StudentReport r={r} zone={zone} targets={[...new Set(programs.flatMap((p) => p.targets))].sort((a, b) => a - b)} />
    </div>
  );
}
