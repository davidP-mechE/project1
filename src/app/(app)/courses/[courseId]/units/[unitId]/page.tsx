import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TestCard } from "@/components/assessment/test-card";
import { Markdown } from "@/components/lesson/markdown";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { getUnitView } from "@/server/assessments";
import { getCourseOr404 } from "@/server/course-page";
import { rangeText } from "@/lib/source-label";
import { NotFoundError } from "@/server/courses";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Unit" };

export default async function UnitPage({ params }: PageProps<"/courses/[courseId]/units/[unitId]">) {
  const user = await requireUser();
  const { courseId, unitId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  let v;
  try {
    v = await getUnitView(user.id, courseId, unitId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const done = v.lessons.filter((l) => l.completed).length;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
          <Link href={`/courses/${courseId}`} className="hover:text-text hover:underline">
            {course.title}
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{v.unit.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {done} of {v.lessons.length} lessons complete
        </p>
      </div>
      {v.assessment?.summary && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Unit summary</h2>
          <Markdown bookId={course.book.id}>{v.assessment.summary}</Markdown>
        </Card>
      )}
      <TestCard
        courseId={courseId}
        kind="UNIT_TEST"
        takeHref={`/courses/${courseId}/units/${unitId}/test`}
        assessment={v.assessment}
        attempts={v.attempts}
        notYet="The unit test is written automatically once every lesson in this unit is ready."
      />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Lessons</h2>
        <ol className="flex flex-col divide-y divide-border">
          {v.lessons.map((l) => (
            <li key={l.id}>
              <Link href={`/courses/${courseId}/lessons/${l.id}`} className="press-soft flex items-center gap-3 py-2.5 text-sm hover:underline">
                <span aria-hidden className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]", l.completed ? "border-success bg-success text-white dark:text-bg" : "border-border")}>
                  {l.completed ? "✓" : ""}
                </span>
                <span className="flex-1">{l.title}</span>
                <span className="text-xs text-muted">{rangeText(course.book.kind, l.pageStart, l.pageEnd)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
