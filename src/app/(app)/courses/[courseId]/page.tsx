import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProcessingStatus } from "@/components/course/processing-status";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/misc";
import { formatBytes } from "@/lib/upload/limits";
import { getCourse, getOutlineSummary, getProcessingStatus, markCourseOpened, NotFoundError } from "@/server/courses";
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
  let course;
  try {
    course = await getCourse(user.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
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
      <PageHeader title={course.title} description={book.originalFilename} />

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

      {outline && <OutlinePreview outline={outline} />}

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

function OutlinePreview({ outline }: { outline: Awaited<ReturnType<typeof getOutlineSummary>> }) {
  const lessonCount = outline.units.reduce((n, u) => n + u.lessons.filter((l) => !l.isFrontBackMatter).length, 0);
  const unitCount = outline.units.filter((u) => !u.isFrontBackMatter).length;
  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold">Detected outline</h2>
      <p className="mt-1 text-sm text-muted">
        {unitCount} units and {lessonCount} lessons, built {sourceLabels[outline.outlineSource ?? "PAGE_RANGES"]}. You&apos;ll be
        able to rename, merge, split and reorder them before lessons are written.
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
          <li key={u.id} className={u.isFrontBackMatter ? "opacity-70" : undefined}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold">{u.title}</h3>
              {u.isFrontBackMatter && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Skipped by default</span>
              )}
            </div>
            {!(u.lessons.length === 1 && u.lessons[0].title === u.title) && (
              <ol className="mt-1 flex flex-col gap-1 border-l border-border pl-4 text-sm">
                {u.lessons.map((l) => (
                  <li key={l.id} className="flex justify-between gap-4">
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
