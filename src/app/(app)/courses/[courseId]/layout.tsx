import { SourceKindProvider } from "@/components/course/source-kind";
import { getCourseOr404 } from "@/server/course-page";
import { requireUser } from "@/server/session";

/** Lets every page and component in a course word things for a book ("p. 4") or slides ("slide 4"). */
export default async function CourseLayout({ children, params }: LayoutProps<"/courses/[courseId]">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  return <SourceKindProvider kind={course.book.kind}>{children}</SourceKindProvider>;
}
