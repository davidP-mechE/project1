import { ProgramBadge } from "@/components/brand/seal";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { CreateClassForm } from "@/components/classes/teacher-forms";
import { listTeaching } from "@/server/classes";
import { myPrograms } from "@/server/programs";
import { Walkthrough } from "@/components/support/walkthrough";
import { toursToShow } from "@/server/tours";
import { ROLE_LABEL } from "@/components/classes/class-nav";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My classes" };

/** The classes this user teaches. Anyone can create one. */
export default async function TeachPage() {
  const user = await requireUser();
  const [classes, programs, tours] = await Promise.all([listTeaching(user.id), myPrograms(user.id), toursToShow(user.id)]);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <PageHeader
        eyebrow="Teaching"
        title="My classes"
        description="Invite students, assign your courses and worksheets, and see how everyone is doing."
        actions={
          <ButtonLink href="/teach/worksheets" variant="secondary">
            Worksheets
          </ButtonLink>
        }
      />
      {tours.staff && <Walkthrough tour="staff" />}
      {programs.length > 0 && (
        <section aria-labelledby="programs-title" className="flex flex-col gap-3">
          <h2 id="programs-title" className="font-display text-2xl font-semibold">
            Your programs
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((p) => {
              const inner = (
                <>
                  <ProgramBadge program={p} className="size-12" />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-lg font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {p.isAdmin ? "You're the admin" : `Admin: ${p.admin.name}`} · {p._count.classes} {p._count.classes === 1 ? "class" : "classes"}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={p.id}>
                  {p.isAdmin ? (
                    <Link href={`/teach/programs/${p.id}`} className="lift flex items-center gap-4 rounded-lg border border-border bg-surface p-4 transition-transform hover:-translate-y-0.5">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {(programs.length === 0 || programs.some((p) => p.isAdmin)) && (
        <Card>
          <CreateClassForm />
          {programs.length === 0 && <p className="mt-3 text-xs text-muted">Your first class starts your own tutoring program; you&apos;ll be its admin and can add teachers and specialists.</p>}
        </Card>
      )}
      {classes.length === 0 ? (
        <EmptyState title="No classes yet">Create a class, then share its code or invite students by email.</EmptyState>
      ) : (
        <section aria-labelledby="classes-title" className="flex flex-col gap-3">
          <h2 id="classes-title" className="font-display text-2xl font-semibold">
            Classes
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c, i) => (
              <li key={c.id}>
                <Link href={`/teach/${c.id}`} className={cn("lift group relative flex h-full flex-col gap-4 overflow-hidden rounded-lg border border-border bg-surface p-5 pl-7 transition-transform hover:-translate-y-0.5", c.archivedAt && "opacity-70")}>
                  <span aria-hidden className="absolute inset-y-0 left-0 w-3" style={{ background: ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)"][i % 5] }} />
                  <span>
                    <span className="block font-display text-xl font-semibold group-hover:underline">{c.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{c.program.name}</span>
                  </span>
                  <span className="grid grid-cols-2 gap-3">
                    <span>
                      <span className="score-num block text-3xl">{c._count.members}</span>
                      <span className="text-xs text-muted">{c._count.members === 1 ? "student" : "students"}</span>
                    </span>
                    <span>
                      <span className="score-num block text-3xl">{c._count.assignments}</span>
                      <span className="text-xs text-muted">{c._count.assignments === 1 ? "assignment" : "assignments"}</span>
                    </span>
                  </span>
                  <span className="mt-auto flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-surface-2 px-2.5 py-1 font-semibold">{ROLE_LABEL[c.role]}</span>
                    <span className="rounded bg-surface-2 px-2.5 py-1">{c.archivedAt ? "Archived" : `Code ${c.joinCode}`}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
