import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TestRunner } from "@/components/assessment/test-runner";
import { StudyTimer } from "@/components/study/study-timer";
import { getTestQuestions, getUnitView } from "@/server/assessments";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Unit test" };

export default async function UnitTestPage({ params }: PageProps<"/courses/[courseId]/units/[unitId]/test">) {
  const user = await requireUser();
  const { courseId, unitId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  let unit;
  try {
    unit = await getUnitView(user.id, courseId, unitId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (!unit.assessment || unit.assessment.status !== "READY") redirect(`/courses/${courseId}/units/${unitId}`);
  const { questions } = await getTestQuestions(user.id, unit.assessment.id);
  return (
    <div className="mx-auto max-w-3xl">
      <StudyTimer />
      <p className="text-sm text-muted">{course.title}</p>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Unit test: {unit.unit.title}</h1>
      <TestRunner assessmentId={unit.assessment.id} bookId={course.book.id} title={`Unit test: ${unit.unit.title}`} questions={questions} backHref={`/courses/${courseId}/units/${unitId}`} />
    </div>
  );
}
