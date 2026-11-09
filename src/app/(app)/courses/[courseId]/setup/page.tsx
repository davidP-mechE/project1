import type { Metadata } from "next";
import { CourseHeader } from "@/components/course/course-header";
import { SettingsForm } from "@/components/course/settings-form";
import { Alert } from "@/components/ui/alert";
import { getCourseOr404 } from "@/server/course-page";
import { GenerateButton } from "@/components/course/generate-button";
import { claudeEnabled } from "@/server/env";
import { getEstimateInputs, getGenerationEstimate, getSettings, isOutlineEditable } from "@/server/outline";
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
        <Alert tone="info">
          {course.status === "GENERATING"
            ? "Lessons are being written right now. You can change settings when generation finishes."
            : "Settings become available once the book has finished processing."}
        </Alert>
      </div>
    );
  }
  const [settings, lessons, pending, all] = await Promise.all([
    getSettings(user.id, courseId),
    getEstimateInputs(user.id, courseId),
    getGenerationEstimate(user.id, courseId, "pending"),
    getGenerationEstimate(user.id, courseId, "all"),
  ]);
  const noKey = claudeEnabled ? undefined : "Lesson generation needs an ANTHROPIC_API_KEY on the server (see the README).";
  const actions = (
    <>
      {pending.lessons > 0 && (
        <GenerateButton
          courseId={courseId}
          estimate={pending}
          label={course.status === "OUTLINE_DRAFT" ? "Generate course" : `Generate ${pending.lessons} remaining`}
          disabledReason={noKey}
        />
      )}
      {course.status === "ACTIVE" && (
        <GenerateButton courseId={courseId} estimate={all} mode="regenerateAll" label="Regenerate all lessons" disabledReason={noKey} />
      )}
    </>
  );
  return (
    <div className="mx-auto max-w-5xl">
      <CourseHeader course={course} />
      <SettingsForm courseId={courseId} initial={settings} lessons={lessons} actions={actions} />
    </div>
  );
}
