import type { Metadata } from "next";
import { CourseHeader } from "@/components/course/course-header";
import { ProcessingStatus } from "@/components/course/processing-status";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { formatBytes } from "@/lib/upload/limits";
import { getOutlineSummary, getProcessingStatus, markCourseOpened } from "@/server/courses";
import { getCourseOr404 } from "@/server/course-page";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Course" };

const sourceLabels: Record<string, string> = {
  BOOKMARKS: "from the PDF's built-in bookmarks",
  HEADINGS: "by detecting headings (this PDF has no bookmarks)",
  PAGE_RANGES: "as fixed page ranges (no chapters or headings were found)",
};

function pageList(pages: number[]): string {
  // [3,4,5,9] -> "3–5, 9"
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return parts.join(", ");
}

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  await markCourseOpened(user.id, courseId);
  const { book } = course;
  const fileAvailable = ["UPLOADED", "PROCESSING", "READY", "FAILED"].includes(book.status) && course.status !== "UPLOADING";
  const showStatus = course.status === "PROCESSING" || (course.status === "FAILED" && book.status !== "AWAITING_UPLOAD");
  const status = showStatus ? await getProcessingStatus(user.id, courseId) : null;
  const outline = ["OUTLINE_DRAFT", "GENERATING", "ACTIVE"].includes(course.status)
    ? await getOutlineSummary(user.id, courseId)
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />

      {course.status === "UPLOADING" && (
        <Alert tone="warning" className="mb-6">
          This upload didn&apos;t finish. Delete it from your library and try again.
        </Alert>
      )}

      {status && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold">
            {course.status === "FAILED" ? "We couldn't process this book" : "Reading your textbook…"}
          </h2>
          <ProcessingStatus key={course.status} courseId={courseId} initial={status} />
        </Card>
      )}

      {outline && course.status === "OUTLINE_DRAFT" && <NextSteps courseId={courseId} />}
      {outline && <OutlinePreview outline={outline} courseId={courseId} />}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">File</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Size</dt>
            <dd className="font-medium">{formatBytes(Number(book.sizeBytes))}</dd>
          </div>
          <div>
            <dt className="text-muted">Pages</dt>
            <dd className="font-medium">{book.pageCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Uploaded</dt>
            <dd className="font-medium">
              <time dateTime={book.createdAt.toISOString()}>
                {book.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
              </time>
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          {fileAvailable && (
            <a href={`/api/books/${book.id}/file`} target="_blank" rel="noopener" className={buttonClasses("secondary")}>
              Open original PDF
            </a>
          )}
          <ButtonLink href="/library" variant="ghost">
            Back to library
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

function NextSteps({ courseId }: { courseId: string }) {
  const steps = [
    { title: "Check the outline", body: "Rename, merge, split or reorder lessons and fix page ranges.", href: `/courses/${courseId}/outline`, cta: "Edit outline" },
    { title: "Choose settings", body: "Pick your level, explanation style and what to create. See the cost estimate.", href: `/courses/${courseId}/setup`, cta: "Course settings" },
    { title: "Generate lessons", body: "Coursebook writes each lesson from its pages. Coming in the next build phase.", href: null, cta: null },
  ];
  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold">Next steps</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-text" aria-hidden>
              {i + 1}
            </span>
            <h3 className="font-medium">{s.title}</h3>
            <p className="flex-1 text-sm text-muted">{s.body}</p>
            {s.href && (
              <ButtonLink href={s.href} variant={i === 0 ? "primary" : "secondary"} size="sm" className="self-start">
                {s.cta}
              </ButtonLink>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function OutlinePreview({ outline, courseId }: { outline: Awaited<ReturnType<typeof getOutlineSummary>>; courseId: string }) {
  const lessonCount = outline.units.reduce((n, u) => n + u.lessons.filter((l) => !l.skip).length, 0);
  const unitCount = outline.units.filter((u) => u.lessons.some((l) => !l.skip)).length;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">Course outline</h2>
        <ButtonLink href={`/courses/${courseId}/outline`} variant="secondary" size="sm">
          Edit outline
        </ButtonLink>
      </div>
      <p className="mt-1 text-sm text-muted">
        {unitCount} units and {lessonCount} lessons. The outline was first built {sourceLabels[outline.outlineSource ?? "PAGE_RANGES"]}.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {outline.ocrPages > 0 && (
          <Alert tone="info">
            {outline.ocrPages} scanned {outline.ocrPages === 1 ? "page was" : "pages were"} read with OCR (text recognition).
            OCR can make small mistakes.
          </Alert>
        )}
        {outline.mathHeavyPages.length > 0 && (
          <Alert tone="warning">
            Equation-heavy pages: {pageList(outline.mathHeavyPages)}. Equations don&apos;t always survive text extraction, so
            these pages will get extra care when lessons are written.
          </Alert>
        )}
        {outline.emptyPages > 0 && (
          <Alert tone="info">
            {outline.emptyPages} {outline.emptyPages === 1 ? "page has" : "pages have"} no readable text (blank pages, or
            pictures without words).
          </Alert>
        )}
      </div>

      <ol className="mt-5 flex flex-col gap-4">
        {outline.units.map((u) => (
          <li key={u.id} className={u.lessons.every((l) => l.skip) ? "opacity-70" : undefined}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold">{u.title}</h3>
              {u.lessons.every((l) => l.skip) && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Skipped</span>
              )}
            </div>
            {!(u.lessons.length === 1 && u.lessons[0].title === u.title) && (
              <ol className="mt-1 flex flex-col gap-1 border-l border-border pl-4 text-sm">
                {u.lessons.map((l) => (
                  <li key={l.id} className={l.skip ? "flex justify-between gap-4 text-muted line-through" : "flex justify-between gap-4"}>
                    <span>{l.title}</span>
                    <span className="shrink-0 text-muted">
                      {l.pageStart === l.pageEnd ? `p. ${l.pageStart}` : `pp. ${l.pageStart}–${l.pageEnd}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {u.lessons.length === 1 && u.lessons[0].title === u.title && (
              <p className="mt-1 text-sm text-muted">
                {u.lessons[0].pageStart === u.lessons[0].pageEnd
                  ? `p. ${u.lessons[0].pageStart}`
                  : `pp. ${u.lessons[0].pageStart}–${u.lessons[0].pageEnd}`}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
