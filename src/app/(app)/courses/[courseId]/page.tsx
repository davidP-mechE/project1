import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/misc";
import { formatBytes } from "@/lib/upload/limits";
import { getCourse, markCourseOpened, NotFoundError } from "@/server/courses";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Course" };

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
  const fileAvailable = ["UPLOADED", "PROCESSING", "READY"].includes(book.status);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={course.title} description={book.originalFilename} />
      {course.status === "FAILED" && (
        <Alert tone="error" className="mb-6">
          {book.error ?? "Something went wrong with this book."}{" "}
          You can delete this course from your library and upload the file again.
        </Alert>
      )}
      {course.status === "UPLOADING" && (
        <Alert tone="warning" className="mb-6">This upload didn&apos;t finish. Delete it from your library and try again.</Alert>
      )}
      {course.status === "PROCESSING" && (
        <Alert tone="info" className="mb-6">
          Your PDF was uploaded and checked. Reading the book and building the outline arrives in the next build phase.
        </Alert>
      )}
      <Card>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">File size</dt><dd className="font-medium">{formatBytes(Number(book.sizeBytes))}</dd></div>
          <div><dt className="text-muted">Uploaded</dt><dd className="font-medium"><time dateTime={book.createdAt.toISOString()}>{book.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</time></dd></div>
          <div><dt className="text-muted">Pages</dt><dd className="font-medium">{book.pageCount ?? "Counted during processing"}</dd></div>
          <div><dt className="text-muted">Status</dt><dd className="font-medium">{course.status.replace("_", " ").toLowerCase()}</dd></div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          {fileAvailable && (
            <a href={`/api/books/${book.id}/file`} target="_blank" rel="noopener" className={buttonClasses("secondary")}>
              Open original PDF
            </a>
          )}
          <ButtonLink href="/library" variant="ghost">Back to library</ButtonLink>
        </div>
      </Card>
    </div>
  );
}
