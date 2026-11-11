import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { NewCourseForm, StatusPill } from "@/components/studio/studio-forms";
import { requireOwner } from "@/server/owner-guard";
import { studioCourses } from "@/server/studio";

export const metadata: Metadata = { title: "Course Studio", robots: { index: false, follow: false } };

export default async function StudioPage() {
  const owner = await requireOwner();
  const courses = await studioCourses(owner.id);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader eyebrow="Owner only" title="Course Studio" description="Your own courses. New courses are private drafts: nobody else can see them until you publish." />
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">New course</h2>
        <NewCourseForm />
      </Card>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {courses.map((c) => (
          <li key={c.id}>
            <Link href={`/studio/courses/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="flex-1">
                <span className="block font-semibold">{c.title}</span>
                <span className="text-xs text-muted">
                  {c.section === "ebrw" ? "EBRW" : c.section === "math" ? "Math" : "Other"} · {c.units.length} unit{c.units.length === 1 ? "" : "s"} · {c.units.reduce((n, u) => n + u._count.lessons, 0)} lessons
                </span>
              </span>
              <StatusPill status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
