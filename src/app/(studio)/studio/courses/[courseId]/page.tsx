import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { CourseOutlineEditor, CourseSettings, StatusPill } from "@/components/studio/studio-forms";
import { requireOwner } from "@/server/owner-guard";
import { NotFoundError } from "@/server/courses";
import { studioCourse } from "@/server/studio";

export const metadata: Metadata = { title: "Course Studio", robots: { index: false, follow: false } };

export default async function StudioCoursePage({ params }: PageProps<"/studio/courses/[courseId]">) {
  const owner = await requireOwner();
  const { courseId } = await params;
  let c;
  try {
    c = await studioCourse(owner.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/studio" className="text-muted hover:underline">← Course Studio</Link>
      </p>
      <PageHeader title={c.title} description={c.status === "published" ? `Published at /learn/${c.slug}` : "Private: only you can see it."} actions={<StatusPill status={c.status} />} />
      <Card>
        <CourseSettings course={{ id: c.id, title: c.title, section: c.section, description: c.description, status: c.status, slug: c.slug }} />
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Units and lessons</h2>
        <CourseOutlineEditor courseId={c.id} units={c.units} />
      </Card>
    </div>
  );
}
