import { PageHeader } from "@/components/ui/misc";
import { isOutlineEditable } from "@/server/outline";
import { CourseTabs } from "./course-tabs";

/** Title + tabs shared by the course's Overview, Outline and Settings pages. */
export function CourseHeader({ course }: { course: { id: string; title: string; status: string; book: { originalFilename: string } } }) {
  return (
    <>
      <PageHeader title={course.title} description={course.book.originalFilename} />
      {isOutlineEditable(course.status) && <CourseTabs courseId={course.id} />}
    </>
  );
}
