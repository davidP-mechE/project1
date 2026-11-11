import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { NewSemesterForm, ProgramPublicPageForm, ProgramSettingsForm, TransferAdminForm } from "@/components/classes/staff-forms";
import { ProgramBadge } from "@/components/brand/seal";
import { CalendarForm } from "@/components/classes/assistant-forms";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { getProgram } from "@/server/programs";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Program" };

const when = (d: Date, zone: string) => `${formatInZone(d, zone, "medium")}, ${formatInZone(d, zone, "time")}`;

/** The program admin's page: settings, handing over the admin role, and the audit log. */
export default async function ProgramPage({ params, searchParams }: PageProps<"/teach/programs/[programId]">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { programId } = await params;
  let data;
  try {
    const { log: logBefore } = await searchParams;
    data = await getProgram(user.id, programId, { logBefore: typeof logBefore === "string" ? logBefore : undefined });
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
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/teach" className="text-muted hover:text-text hover:underline">
          ← My classes
        </Link>
      </p>
      <ProgramBadge program={program} className="size-14" />
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
        <h2 className="mb-1 text-lg font-semibold">Public page</h2>
        <p className="mb-4 text-sm text-muted">
          An optional page about the program, with sign-up and log-in buttons.{" "}
          {program.isPublic && program.slug ? (
            <Link href={`/p/${program.slug}`} className="text-primary underline">
              Open /p/{program.slug}
            </Link>
          ) : (
            "It's off until you choose an address and make it live."
          )}
        </p>
        <ProgramPublicPageForm program={program} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">School calendar</h2>
        <p className="mb-4 text-sm text-muted">Curriculum units are laid out on school weeks from the term start, skipping these days.</p>
        <CalendarForm programId={program.id} termStart={program.termStart?.toISOString().slice(0, 10) ?? null} termEnd={program.termEnd?.toISOString().slice(0, 10) ?? null} closedDates={program.closedDates.map((d) => d.toISOString().slice(0, 10))} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Start a new semester</h2>
        <p className="mb-4 text-sm text-muted">Copy this semester&apos;s classes into fresh ones and archive the old ones.</p>
        <NewSemesterForm programId={program.id} classes={program.classes.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.name, students: c._count.members }))} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Hand over the admin role</h2>
        <p className="mb-4 text-sm text-muted">
          For when you step down (for example, when you graduate). The new admin gets full control; you stay on every class as a teacher until you remove yourself. See the admin guide (ADMIN_GUIDE.md) for the full handover checklist.
        </p>
        <TransferAdminForm programId={program.id} programName={program.name} staff={staff} />
      </Card>
      <Card>
        <h2 id="audit" className="mb-1 scroll-mt-20 text-lg font-semibold">Audit log</h2>
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
                  {when(l.createdAt, zone)}
                </time>
              </li>
            ))}
          </ul>
        )}
        {data.logOlder && (
          <Link href={`/teach/programs/${programId}?log=${data.logOlder}#audit`} className="mt-3 inline-block text-sm text-primary underline">
            Older entries
          </Link>
        )}
      </Card>
    </div>
  );
}
