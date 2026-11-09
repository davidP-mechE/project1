import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TestRunner } from "@/components/assessment/test-runner";
import { StudyTimer } from "@/components/study/study-timer";
import { getFinalExamView, getTestQuestions } from "@/server/assessments";
import { getCourseOr404 } from "@/server/course-page";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Final exam" };

export default async function FinalExamTestPage({ params }: PageProps<"/courses/[courseId]/final-exam/test">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  const v = await getFinalExamView(user.id, courseId);
  if (!v.assessment || v.assessment.status !== "READY") redirect(`/courses/${courseId}/final-exam`);
  const { questions } = await getTestQuestions(user.id, v.assessment.id);
  return (
    <div className="mx-auto max-w-3xl">
      <StudyTimer />
      <p className="text-sm text-muted">{course.title}</p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Final exam</h1>
      <TestRunner assessmentId={v.assessment.id} bookId={course.book.id} title={`Final exam: ${course.title}`} questions={questions} backHref={`/courses/${courseId}/final-exam`} />
    </div>
  );
}
