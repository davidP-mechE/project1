import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { NotFoundError } from "@/server/courses";
import { previewGuardianEmail } from "@/server/guardian-progress";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Progress email preview" };

const FREQ = { OFF: "Parent progress emails are off for this program. The program admin turns them on (weekly or monthly) on the program page.", WEEKLY: "Sent weekly, on Sunday evening.", MONTHLY: "Sent monthly, on the 1st." } as const;

/** What this student's guardians would get in their next progress email (nothing is sent from here). */
export default async function ProgressEmailPreview({ params }: PageProps<"/teach/[classId]/students/[studentId]/progress-email">) {
  const user = await requireUser();
  const { classId, studentId } = await params;
  let p;
  try {
    p = await previewGuardianEmail(user.id, classId, studentId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="text-sm"><Link href={`/teach/${classId}/students/${studentId}`} className="text-muted hover:text-text hover:underline">← {p.studentName}</Link></p>
      <PageHeader title="Progress email preview" description="The numbers as they stand now. Nothing is sent from this page." />
      <Alert tone={p.frequency === "OFF" ? "warning" : "info"}>{FREQ[p.frequency]}</Alert>
      {!p.hasGuardian && <Alert tone="warning">No guardian has been added for this student, so nobody gets this email yet.</Alert>}
      <Card className="flex flex-col gap-3">
        <dl className="grid gap-1 text-sm sm:grid-cols-[6rem_1fr]">
          <dt className="text-muted">To</dt>
          <dd>{p.message.to}</dd>
          <dt className="text-muted">Subject</dt>
          <dd className="font-semibold">{p.message.subject}</dd>
        </dl>
        <pre className="whitespace-pre-wrap rounded-md bg-surface-2 p-4 font-sans text-sm">{p.message.text}</pre>
      </Card>
    </div>
  );
}
