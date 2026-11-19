import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { BulkAssignForm, CaseloadImport, TutorSelect } from "@/components/attention/caseload-forms";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { caseloadView } from "@/server/caseloads";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Caseloads" };

type Row = { id: string; name: string; email: string; needs: number; lastContact: Date | null };

/** The program admin's caseloads: each tutor's students, who needs attention, and when they last talked. */
export default async function CaseloadsPage({ params }: PageProps<"/teach/programs/[programId]/caseloads">) {
  const user = await requireUser();
  const { programId } = await params;
  let v;
  try {
    v = await caseloadView(user.id, programId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ClassError) return <PageHeader title="Caseloads" description={err.message} />;
    throw err;
  }
  const zone = await viewerZone();
  const table = (rows: Row[], tutorId: string | null, caption: string) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Student</th>
            <th className="py-2 pr-3 font-medium">Needs attention</th>
            <th className="py-2 pr-3 font-medium">Last contact</th>
            <th className="py-2 font-medium">Primary tutor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <span className="font-medium">{s.name}</span>
                <span className="block text-xs text-muted">{s.email}</span>
              </td>
              <td className="py-2 pr-3 tabular-nums">{s.needs ? <Link href="/teach/attention" className="font-semibold text-warning underline-offset-2 hover:underline">{s.needs} item{s.needs === 1 ? "" : "s"}</Link> : <span className="text-muted">None</span>}</td>
              <td className="py-2 pr-3">{s.lastContact ? formatInZone(s.lastContact, zone, "medium") : tutorId ? <span className="text-muted">No messages yet</span> : <span className="text-muted">–</span>}</td>
              <td className="py-2">
                <TutorSelect programId={programId} studentId={s.id} studentName={s.name} tutorId={tutorId} tutors={v.tutors} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/programs/${programId}`} className="text-muted hover:text-text hover:underline">← {v.program.name}</Link>
      </p>
      <PageHeader title="Caseloads" description={`Each student's primary tutor. Tutors can filter their needs-attention list to their caseload, and students see who their tutor is. ${v.total} student${v.total === 1 ? "" : "s"} in the program, ${v.unassigned.length} without a tutor.`} />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Assign a class or group</h2>
        <BulkAssignForm programId={programId} classes={v.classes} tutors={v.tutors} />
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Import from a CSV</h2>
        <CaseloadImport programId={programId} />
      </Card>
      {v.total === 0 ? (
        <EmptyState title="No students yet">Students appear here once they join one of the program&apos;s classes.</EmptyState>
      ) : (
        <>
          {v.loads.filter((l) => l.students.length).map((l) => (
            <Card key={l.tutor.id}>
              <h2 className="text-lg font-semibold">{l.tutor.name}</h2>
              <p className="mb-2 text-sm text-muted">
                {l.students.length} student{l.students.length === 1 ? "" : "s"} · {l.needing} need{l.needing === 1 ? "s" : ""} attention
              </p>
              {table(l.students, l.tutor.id, `${l.tutor.name}'s caseload`)}
            </Card>
          ))}
          {v.loads.some((l) => !l.students.length) && (
            <p className="text-sm text-muted">No caseload yet: {v.loads.filter((l) => !l.students.length).map((l) => l.tutor.name).join(", ")}.</p>
          )}
          {v.unassigned.length > 0 && (
            <Card>
              <h2 className="text-lg font-semibold">No tutor yet</h2>
              <p className="mb-2 text-sm text-muted">{v.unassigned.length} student{v.unassigned.length === 1 ? "" : "s"}</p>
              {table(v.unassigned, null, "Students without a primary tutor")}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
