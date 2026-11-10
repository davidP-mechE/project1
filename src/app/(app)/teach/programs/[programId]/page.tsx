import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { ProgramSettingsForm, TransferAdminForm } from "@/components/classes/staff-forms";
import { CalendarForm } from "@/components/classes/assistant-forms";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { getProgram } from "@/server/programs";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Program" };

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The program admin's page: settings, handing over the admin role, and the audit log. */
export default async function ProgramPage({ params }: PageProps<"/teach/programs/[programId]">) {
  const user = await requireUser();
  const { programId } = await params;
  let data;
  try {
    data = await getProgram(user.id, programId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ClassError) {
      return (
        <div className="mx-auto max-w-3xl">
          <PageHeader title="Program" description={err.message} />
        </div>
      );
    }
    throw err;
  }
  const { program, staff, log } = data;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/teach" className="text-muted hover:text-text hover:underline">
          ← My classes
        </Link>
      </p>
      <PageHeader
        title={program.name}
        description={`You're the program admin · ${program.classes.length} ${program.classes.length === 1 ? "class" : "classes"}`}
        actions={<ButtonLink href={`/teach/programs/${program.id}/dashboard`}>Program dashboard</ButtonLink>}
      />
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Settings</h2>
        <ProgramSettingsForm program={program} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">School calendar</h2>
        <p className="mb-4 text-sm text-muted">Curriculum units are laid out on school weeks from the term start, skipping these days.</p>
        <CalendarForm programId={program.id} termStart={program.termStart?.toISOString().slice(0, 10) ?? null} termEnd={program.termEnd?.toISOString().slice(0, 10) ?? null} closedDates={program.closedDates.map((d) => d.toISOString().slice(0, 10))} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Hand over the admin role</h2>
        <p className="mb-4 text-sm text-muted">
          For when you step down (for example, when you graduate). The new admin gets full control; you stay on every class as a teacher until you remove yourself. See the admin guide (ADMIN_GUIDE.md) for the full handover checklist.
        </p>
        <TransferAdminForm programId={program.id} programName={program.name} staff={staff} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Audit log</h2>
        <p className="mb-4 text-sm text-muted">Every staff, role, scope, group and grade-override change. Entries can&apos;t be edited or deleted.</p>
        {log.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                <span>
                  <span className="font-medium">{l.actorName}</span>: {l.summary}
                </span>
                <time className="text-xs text-muted" dateTime={l.createdAt.toISOString()}>
                  {when(l.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
