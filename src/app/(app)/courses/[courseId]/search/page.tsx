import type { Metadata } from "next";
import Link from "next/link";
import { CourseHeader } from "@/components/course/course-header";
import { SearchBox } from "@/components/course/search-box";
import { Snippet } from "@/components/course/snippet";
import { getCourseOr404 } from "@/server/course-page";
import { searchCourse } from "@/server/search";
import { requireUser } from "@/server/session";
import { bookPageHref } from "@/components/lesson/cite-pages";
import { rangeText, sourceNoun } from "@/lib/source-label";

export const metadata: Metadata = { title: "Search" };


export default async function SearchPage({ params, searchParams }: PageProps<"/courses/[courseId]/search">) {
  const user = await requireUser();
  const { courseId } = await params;
  const sp = await searchParams;
  const course = await getCourseOr404(user.id, courseId);
  const kind = course.book.kind;
  const pages = (a: number, b: number) => rangeText(kind, a, b);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const results = q.trim() ? await searchCourse(user.id, courseId, q) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />
      <SearchBox courseId={courseId} initial={q} />
      {results && (
        <div className="mt-6 flex flex-col gap-8">
          {!results.query || (results.lessons.length === 0 && results.book.length === 0) ? (
            <p className="text-sm text-muted">No results for &ldquo;{q}&rdquo;. Try fewer or different words.</p>
          ) : (
            <>
              <section aria-labelledby="in-lessons">
                <h2 id="in-lessons" className="mb-3 text-lg font-semibold">
                  In your lessons <span className="text-sm font-normal text-muted">({results.lessons.length})</span>
                </h2>
                {results.lessons.length === 0 ? (
                  <p className="text-sm text-muted">No lessons mention this.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {results.lessons.map((l) => (
                      <li key={l.id}>
                        <Link href={`/courses/${courseId}/lessons/${l.id}`} className="press-soft block rounded-xl border border-border bg-surface p-4 hover:bg-surface-2">
                          <span className="text-xs text-muted">
                            {l.unitTitle} · {pages(l.pageStart, l.pageEnd)}
                          </span>
                          <span className="mt-0.5 block font-medium">{l.title}</span>
                          {l.snippet && <Snippet text={l.snippet} className="mt-1 block text-sm text-muted" />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="in-book">
                <h2 id="in-book" className="mb-3 text-lg font-semibold">
                  In the {sourceNoun(kind)} <span className="text-sm font-normal text-muted">({results.book.length})</span>
                </h2>
                {results.book.length === 0 ? (
                  <p className="text-sm text-muted">{kind === "SLIDES" ? "The slides don’t contain this." : "The book’s text doesn’t contain this."}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {results.book.map((b) => (
                      <li key={b.id} className="rounded-xl border border-border bg-surface p-4">
                        <span className="text-xs text-muted">{pages(b.pageStart, b.pageEnd)}</span>
                        <Snippet text={b.snippet} className="mt-1 block text-sm" />
                        <span className="mt-2 flex flex-wrap gap-3 text-xs">
                          {b.lessonId && (
                            <Link href={`/courses/${courseId}/lessons/${b.lessonId}?book=${b.pageStart}`} className="font-medium text-primary hover:underline">
                              Open beside “{b.lessonTitle}”
                            </Link>
                          )}
                          <a href={bookPageHref(course.book.id, b.pageStart)} target="_blank" rel="noopener" className="text-muted hover:text-text hover:underline">
                            Open the PDF ↗
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
