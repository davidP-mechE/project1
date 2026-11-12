import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/misc";
import { LessonBlocks } from "@/components/studio/course-view";
import { requireOwner } from "@/server/owner-guard";
import { NotFoundError } from "@/server/courses";
import { db } from "@/server/db";
import { studioLesson } from "@/server/studio";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default async function PreviewLessonPage({ params }: PageProps<"/studio/courses/[courseId]/preview/[lessonId]">) {
  const owner = await requireOwner();
  const { courseId, lessonId } = await params;
  let l;
  try {
    l = await studioLesson(owner.id, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (l.unit.course.id !== courseId) notFound();
  // As a student: question-set blocks only for published sets.
  const setIds = l.blocks.flatMap((b) => (b.kind === "question_set" ? [String((b.data as { setId?: string }).setId)] : []));
  const sets = await db.questionSet.findMany({ where: { id: { in: setIds }, status: "published" }, select: { id: true, title: true, status: true, questionIds: true } });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Alert tone="info">
        Preview as a student. <Link href={`/studio/lessons/${l.id}`} className="underline">Back to editing</Link>
      </Alert>
      <p className="text-sm">
        <Link href={`/studio/courses/${courseId}/preview`} className="text-muted hover:underline">← {l.unit.course.title}</Link>
      </p>
      <PageHeader eyebrow={l.unit.title} title={l.title} />
      <LessonBlocks blocks={l.blocks} files={l.files} sets={Object.fromEntries(sets.map((s) => [s.id, s]))} section={l.unit.course.section} desmosKey={env.DESMOS_API_KEY ?? null} lessonId={l.id} />
    </div>
  );
}
