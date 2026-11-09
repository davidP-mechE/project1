import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceKindProvider } from "@/components/course/source-kind";
import { SkillDrill } from "@/components/review/skill-drill";
import { StudyTimer } from "@/components/study/study-timer";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { claudeEnabled, env } from "@/server/env";
import { getSkillDrill } from "@/server/review";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Hammer a skill" };

export default async function SkillDrillPage({ searchParams }: PageProps<"/skills/drill">) {
  const user = await requireUser();
  const sp = await searchParams;
  if (typeof sp.course !== "string" || typeof sp.skill !== "string" || sp.course.length > 64 || sp.skill.length > 200) notFound();
  const course = await getCourseOr404(user.id, sp.course);
  let drill;
  try {
    drill = await getSkillDrill(user.id, sp.course, sp.skill);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const grading = env.FAKE_CLAUDE ? "demo" : claudeEnabled ? "claude" : null;
  return (
    <SourceKindProvider kind={course.book.kind}>
      <div className="mx-auto max-w-2xl">
        <StudyTimer />
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
          <Link href="/skills" className="hover:text-text hover:underline">
            Review
          </Link>
          <span aria-hidden> › </span>
          <Link href={`/skills?course=${course.id}`} className="hover:text-text hover:underline">
            {course.title}
          </Link>
        </nav>
        <h1 className="sr-only">Hammer a skill: {drill.topic}</h1>
        <SkillDrill courseId={course.id} bookId={course.book.id} skillKey={drill.key} topic={drill.topic} items={drill.items} grading={grading} canGenerate={claudeEnabled} />
      </div>
    </SourceKindProvider>
  );
}
