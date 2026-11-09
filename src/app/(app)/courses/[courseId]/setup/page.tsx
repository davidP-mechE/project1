import type { Metadata } from "next";
import { CourseHeader } from "@/components/course/course-header";
import { SettingsForm } from "@/components/course/settings-form";
import { Alert } from "@/components/ui/alert";
import { getCourseOr404 } from "@/server/course-page";
import { getEstimateInputs, getSettings, isOutlineEditable } from "@/server/outline";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Course settings" };

export default async function SetupPage({ params }: PageProps<"/courses/[courseId]/setup">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  if (!isOutlineEditable(course.status)) {
    return (
      <div className="mx-auto max-w-4xl">
        <CourseHeader course={course} />
        <Alert tone="info">Settings become available once the book has finished processing.</Alert>
      </div>
    );
  }
  const [settings, lessons] = await Promise.all([getSettings(user.id, courseId), getEstimateInputs(user.id, courseId)]);
  return (
    <div className="mx-auto max-w-5xl">
      <CourseHeader course={course} />
      <SettingsForm courseId={courseId} initial={settings} lessons={lessons} />
    </div>
  );
}
