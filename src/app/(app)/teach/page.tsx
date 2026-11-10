import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { CreateClassForm } from "@/components/classes/teacher-forms";
import { listTeaching } from "@/server/classes";
import { myPrograms } from "@/server/programs";
import { ROLE_LABEL } from "@/components/classes/class-nav";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My classes" };

/** The classes this user teaches. Anyone can create one. */
export default async function TeachPage() {
  const user = await requireUser();
  const [classes, programs] = await Promise.all([listTeaching(user.id), myPrograms(user.id)]);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="My classes"
        description="Invite students, assign your courses and worksheets, and see how everyone is doing."
        actions={
          <ButtonLink href="/teach/worksheets" variant="secondary">
            Worksheets
          </ButtonLink>
        }
      />
      {programs.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Your programs</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {programs.map((p) => (
              <li key={p.id}>
                {p.isAdmin ? (
                  <Link href={`/teach/programs/${p.id}`} className="font-medium text-primary underline">
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium">{p.name}</span>
                )}{" "}
                <span className="text-muted">
                  · {p.isAdmin ? "you're the admin" : `admin: ${p.admin.name}`} · {p._count.classes} {p._count.classes === 1 ? "class" : "classes"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
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
        <ul className="grid gap-4 sm:grid-cols-2">
          {classes.map((c) => (
            <li key={c.id}>
              <Link href={`/teach/${c.id}`} className="card-hover lift block rounded-2xl border border-border bg-surface p-5">
                <p className="text-lg font-semibold">{c.name}</p>
                <p className="mt-1 text-sm text-muted">
                  {c._count.members} {c._count.members === 1 ? "student" : "students"} · {c._count.assignments} {c._count.assignments === 1 ? "assignment" : "assignments"}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {ROLE_LABEL[c.role]} · {c.program.name} · {c.archivedAt ? "Archived" : `Code ${c.joinCode}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
