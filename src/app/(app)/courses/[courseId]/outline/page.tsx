import type { Metadata } from "next";
import { CourseHeader } from "@/components/course/course-header";
import { OutlineEditor } from "@/components/outline/outline-editor";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getCourseOr404 } from "@/server/course-page";
import { getOutlineForEditing } from "@/server/outline";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Edit outline" };

export default async function OutlinePage({ params }: PageProps<"/courses/[courseId]/outline">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  const data = await getOutlineForEditing(user.id, courseId);

  return (
    <div className="mx-auto max-w-4xl">
      <CourseHeader course={course} />
      {!data.editable ? (
        <Alert tone="info">
          The outline can be edited once the book has finished processing.{" "}
          <ButtonLink href={`/courses/${courseId}`} variant="ghost" size="sm">
            Back to overview
          </ButtonLink>
        </Alert>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Each <strong className="text-text">unit</strong> is usually a chapter and each{" "}
            <strong className="text-text">lesson</strong> a section. Lessons are written from their pages only, so check that
            each lesson&apos;s pages are right. Use the eye button to see where a lesson&apos;s pages begin and end. Skipped
            lessons won&apos;t be generated.
          </p>
          <OutlineEditor courseId={courseId} pageCount={data.pageCount} initial={data.outline} detected={data.detected} />
        </>
      )}
    </div>
  );
}
