import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { CreateClassForm } from "@/components/classes/teacher-forms";
import { listTeaching } from "@/server/classes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My classes" };

/** The classes this user teaches. Anyone can create one. */
export default async function TeachPage() {
  const user = await requireUser();
  const classes = await listTeaching(user.id);
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
      <Card>
        <CreateClassForm />
      </Card>
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
                <p className="mt-2 text-xs text-muted">{c.archivedAt ? "Archived" : `Code ${c.joinCode}`}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
