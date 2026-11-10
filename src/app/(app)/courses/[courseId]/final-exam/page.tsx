import type { Metadata } from "next";
import { CourseHeader } from "@/components/course/course-header";
import { TestCard } from "@/components/assessment/test-card";
import { getFinalExamView } from "@/server/assessments";
import { getCourseOr404 } from "@/server/course-page";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Final exam" };

export default async function FinalExamPage({ params }: PageProps<"/courses/[courseId]/final-exam">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  const v = await getFinalExamView(user.id, courseId);
  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />
      <TestCard
        zone={zone}
        courseId={courseId}
        kind="FINAL_EXAM"
        takeHref={`/courses/${courseId}/final-exam/test`}
        assessment={v.assessment}
        attempts={v.attempts}
        notYet="The final exam is written automatically once every unit's test is ready. It covers the whole course."
      />
    </div>
  );
}
