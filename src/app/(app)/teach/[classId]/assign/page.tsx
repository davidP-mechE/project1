import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { ClassNav } from "@/components/classes/class-nav";
import { AssignLessonsForm } from "@/components/classes/assign-lessons-form";
import { ExternalAssignForm } from "@/components/classes/external-forms";
import { NotFoundError } from "@/server/courses";
import { assignableCourses, getClassForTeacher } from "@/server/classes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Assign lessons" };

/** Assign one of the teacher's courses, or chosen lessons from it. Each student gets their own copy. */
export default async function AssignPage({ params }: PageProps<"/teach/[classId]/assign">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, courses;
  try {
    [c, courses] = await Promise.all([getClassForTeacher(user.id, classId), assignableCourses(user.id)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <ClassNav c={c} active="assign" />
      {courses.length === 0 ? (
        <EmptyState title="No courses to assign yet" action={<ButtonLink href="/library">Go to your library</ButtonLink>}>
          Upload a textbook or slides and generate the course; then you can assign it here.
        </EmptyState>
      ) : (
        <Card>
          <p className="mb-5 text-sm text-muted">
            Each student gets their own copy of the course when they start, so their notes and answers are theirs. You&apos;ll see their progress on the lessons you assign. For questions from a worksheet, go to{" "}
            <Link href="/teach/worksheets" className="underline">
              Worksheets
            </Link>
            .
          </p>
          <AssignLessonsForm classId={c.id} courses={courses.map((x) => ({ id: x.id, title: x.title, units: x.units }))} />
        </Card>
      )}
      <Card>
        <h2 className="mb-1 text-lg font-semibold">College Board practice (by link)</h2>
        <p className="mb-4 text-sm text-muted">
          Attach questions from the College Board&apos;s Student Question Bank by their link and question ID. Students open them on the College Board site and record how they did here. Coursebook never copies or stores the questions themselves.
        </p>
        <ExternalAssignForm classId={c.id} />
      </Card>
    </div>
  );
}
