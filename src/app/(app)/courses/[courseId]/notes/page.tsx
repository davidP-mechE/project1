import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseHeader } from "@/components/course/course-header";
import { Markdown } from "@/components/lesson/markdown";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { HIGHLIGHT_SWATCH } from "@/components/study/highlight-colors";
import { getCourseOr404 } from "@/server/course-page";
import { NotFoundError } from "@/server/courses";
import { getCourseNotes } from "@/server/notes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Notes" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every highlight and note in the course, lesson by lesson. */
export default async function NotesPage({ params }: PageProps<"/courses/[courseId]/notes">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  let data;
  try {
    data = await getCourseNotes(user.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const count = data.lessons.reduce((n, l) => n + l.highlights.length + (l.note ? 1 : 0), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />
      {count === 0 ? (
        <EmptyState title="No notes yet">
          In a lesson, select text to highlight it or add a note. You can also write notes under each lesson. Everything shows up here.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {plural(data.lessons.reduce((n, l) => n + l.highlights.length, 0), "highlight")} · {plural(data.lessons.filter((l) => l.note).length, "lesson note")}
            </p>
            <a href={`/api/courses/${courseId}/notes/export`} className={buttonClasses("secondary", "sm")} download>
              Export as Markdown
            </a>
          </div>
          <ol className="flex flex-col gap-8">
            {data.lessons.map((l) => (
              <li key={l.id}>
                <p className="text-xs uppercase tracking-wide text-muted">{l.unitTitle}</p>
                <h2 className="text-lg font-semibold">
                  <Link href={`/courses/${courseId}/lessons/${l.id}`} className="hover:underline">
                    {l.title}
                  </Link>
                </h2>
                {l.note && (
                  <div className="mt-3 rounded-xl border border-border bg-surface p-4">
                    <p className="mb-1 text-xs font-medium text-muted">My notes</p>
                    <Markdown>{l.note}</Markdown>
                  </div>
                )}
                {l.highlights.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-3">
                    {l.highlights.map((h) => (
                      <li key={h.id} className="rounded-xl border border-border bg-surface p-4">
                        <blockquote className="border-l-4 pl-3 text-sm" style={{ borderColor: HIGHLIGHT_SWATCH[h.color] }}>
                          {h.exact}
                        </blockquote>
                        {h.note && <p className="mt-2 whitespace-pre-wrap text-sm">{h.note}</p>}
                        <Link href={`/courses/${courseId}/lessons/${l.id}#hl-${h.id}`} className="mt-2 inline-block text-xs text-muted hover:text-text hover:underline">
                          Show in lesson
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
