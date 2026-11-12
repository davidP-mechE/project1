import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { LessonEditor } from "@/components/studio/studio-forms";
import { requireOwner } from "@/server/owner-guard";
import { NotFoundError } from "@/server/courses";
import { studioLesson, studioSetOptions } from "@/server/studio";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Course Studio", robots: { index: false, follow: false } };

export default async function StudioLessonPage({ params }: PageProps<"/studio/lessons/[lessonId]">) {
  const owner = await requireOwner();
  const { lessonId } = await params;
  let l;
  try {
    l = await studioLesson(owner.id, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const sets = await studioSetOptions(owner.id);
  const course = l.unit.course;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/studio/courses/${course.id}`} className="text-muted hover:underline">← {course.title}</Link>
        {" · "}
        <Link href={`/studio/courses/${course.id}/preview/${l.id}`} className="text-muted hover:underline">Preview as student</Link>
      </p>
      <PageHeader eyebrow={l.unit.title} title={l.title} />
      <Card>
        <LessonEditor key={l.blocks.map((b) => b.id).join(",")} lesson={{ id: l.id, title: l.title, desmosTechnique: l.desmosTechnique, courseId: course.id }} blocks={l.blocks.map((b) => ({ id: b.id, kind: b.kind, data: (b.data ?? {}) as Record<string, unknown> }))} files={l.files} sets={sets} desmosKey={env.DESMOS_API_KEY ?? null} />
      </Card>
    </div>
  );
}
