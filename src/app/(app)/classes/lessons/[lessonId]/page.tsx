import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Markdown } from "@/components/lesson/markdown";
import { NotFoundError } from "@/server/courses";
import { lessonForStudent } from "@/server/assistant";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Lesson" };

/** A lesson from the student's tutors (approved by staff). */
export default async function StudentLessonPage({ params }: PageProps<"/classes/lessons/[lessonId]">) {
  const user = await requireUser();
  const { lessonId } = await params;
  let l;
  try {
    l = await lessonForStudent(user.id, lessonId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/classes" className="text-muted hover:text-text hover:underline">
          ← {l.class.name}
        </Link>
      </p>
      <PageHeader title={l.title} />
      <Card>
        <Markdown>{l.content}</Markdown>
      </Card>
    </div>
  );
}
