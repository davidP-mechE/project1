import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/misc";
import { CourseOutline } from "@/components/studio/course-view";
import { requireOwner } from "@/server/owner-guard";
import { NotFoundError } from "@/server/courses";
import { studioCourse } from "@/server/studio";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** The course exactly as students will see it (same components as /learn). */
export default async function PreviewCoursePage({ params }: PageProps<"/studio/courses/[courseId]/preview">) {
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
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Alert tone="info">
        Preview as a student. {c.status === "published" ? "This course is published." : "This course is a draft: students can't see it yet."} <Link href={`/studio/courses/${c.id}`} className="underline">Back to editing</Link>
      </Alert>
      <PageHeader eyebrow="Course" title={c.title} />
      <CourseOutline course={c} lessonHref={(id) => `/studio/courses/${c.id}/preview/${id}`} />
    </div>
  );
}
