import { ViewTransition } from "react";
import { PageHeader } from "@/components/ui/misc";
import { CourseCover } from "@/components/library/cover";
import { CourseTabs } from "./course-tabs";

type HeaderCourse = { id: string; title: string; status: string; book: { id?: string; originalFilename: string; coverKey?: string | null } };

/** Title + tabs shared by the course's Overview, Outline and Settings pages. */
export function CourseHeader({ course }: { course: HeaderCourse }) {
  const coverUrl = course.book.id && course.book.coverKey ? `/api/books/${course.book.id}/cover` : null;
  return (
    <>
      <div className="flex items-start gap-4">
        {/* Shares its name with the Library card's cover, so the cover glides here when the course opens. */}
        <ViewTransition name={`cover-${course.id}`} share="cover-morph" default="none">
          <div className="hidden w-14 shrink-0 sm:block">
            <CourseCover title={course.title} coverUrl={coverUrl} />
          </div>
        </ViewTransition>
        <div className="min-w-0 flex-1">
          <PageHeader title={course.title} description={course.book.originalFilename} />
        </div>
      </div>
      {["OUTLINE_DRAFT", "GENERATING", "ACTIVE"].includes(course.status) && <CourseTabs courseId={course.id} study={["GENERATING", "ACTIVE"].includes(course.status)} />}
    </>
  );
}
