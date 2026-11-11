import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { LessonBlocks } from "@/components/studio/course-view";
import { getSession } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { lessonForViewer } from "@/server/studio";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Lesson" };

export default async function LearnLessonPage({ params }: PageProps<"/learn/[slug]/lessons/[lessonId]">) {
  const { slug, lessonId } = await params;
  const session = await getSession();
  let v;
  try {
    v = await lessonForViewer(session?.user.id ?? null, slug, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (!session) redirect(`/login?next=/learn/${slug}/lessons/${lessonId}`);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <p className="text-sm">
        <Link href={`/learn/${slug}`} className="text-muted hover:underline">← {v.course.title}</Link>
      </p>
      <PageHeader eyebrow={v.lesson.unit.title} title={v.lesson.title} />
      <LessonBlocks blocks={v.lesson.blocks} files={v.lesson.files} sets={v.sets} section={v.course.section} desmosKey={env.DESMOS_API_KEY ?? null} lessonId={v.lesson.id} />
    </div>
  );
}
