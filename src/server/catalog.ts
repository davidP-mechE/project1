import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { copyCourseTo, snapshotFiles } from "./course-copy";
import { isSubjectId, type SubjectId } from "@/lib/subjects";
import { detectSubject } from "./subjects";

/**
 * The Hub: provided courses (for example OpenStax textbooks). An admin uploads
 * and generates the course like any other, then publishes it here. Students
 * add it to their library and get their own copy: the outline, lessons,
 * questions, flashcards and tests are copied (so progress, notes and edits
 * are theirs), while the book's files are shared from catalog/<entry id>/.
 * Nothing is sent to Claude, so it costs the student nothing.
 */

export class CatalogError extends Error {}

export type PublishInput = { description: string; subject: SubjectId; license: string; attribution: string; sourceUrl?: string | null };

const catalogPrefix = (entryId: string) => `catalog/${entryId}/`;

/** Admins only (checked by the caller). Publishes (or updates) a course in the Hub. */
export async function publishCourse(courseId: string, input: PublishInput) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, status: true, catalogEntryId: true, publishedAs: { select: { id: true } }, book: { select: { id: true, storageKey: true, coverKey: true, figures: { select: { storageKey: true } } } } },
  });
  if (!course) throw new NotFoundError("Course not found");
  if (course.catalogEntryId) throw new CatalogError("This course was added from the Hub. Publish the original course instead.");
  if (!["ACTIVE", "GENERATING"].includes(course.status)) throw new CatalogError("Generate the course before publishing it.");
  const data = {
    title: course.title,
    subject: input.subject,
    description: input.description.trim().slice(0, 600),
    license: input.license.trim().slice(0, 80) || "CC BY 4.0",
    attribution: input.attribution.trim().slice(0, 600),
    sourceUrl: input.sourceUrl?.trim() || null,
    published: true,
  };
  if (!data.description) throw new CatalogError("Add a short description.");
  if (!data.attribution) throw new CatalogError("Add the attribution the book's license requires (for OpenStax: the book, its authors, and a link to openstax.org).");

  if (course.publishedAs) return db.catalogEntry.update({ where: { id: course.publishedAs.id }, data });

  // First publish: copy the files to the catalog, so students' copies keep working even if this course is changed or deleted.
  const id = randomUUID().replace(/-/g, "");
  const files = await snapshotFiles(course.book, catalogPrefix(id));
  return db.catalogEntry.create({
    data: { id, sourceCourseId: course.id, fileKey: files.fileKey, coverKey: files.coverKey, ...data },
  });
}

export async function setPublished(entryId: string, published: boolean) {
  await db.catalogEntry.update({ where: { id: entryId }, data: { published } });
}

/** What a course page needs to show an admin the "Publish to the Hub" form. */
export async function getPublishState(courseId: string) {
  const entry = await db.catalogEntry.findUnique({ where: { sourceCourseId: courseId }, select: { id: true, description: true, subject: true, license: true, attribution: true, sourceUrl: true, published: true, _count: { select: { enrollments: true } } } });
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, select: { subject: true } });
  return { entry, subject: isSubjectId(course.subject) ? course.subject : await detectSubject(courseId) };
}

/** The Hub: published entries, and which ones this student already has. */
export async function listCatalog(userId: string, opts: { includeHidden?: boolean } = {}) {
  const [entries, mine] = await Promise.all([
    db.catalogEntry.findMany({
      where: opts.includeHidden ? {} : { published: true },
      orderBy: [{ subject: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        subject: true,
        description: true,
        license: true,
        attribution: true,
        sourceUrl: true,
        coverKey: true,
        published: true,
        sourceCourse: { select: { book: { select: { kind: true, pageCount: true } }, _count: { select: { lessons: { where: { skip: false } } } } } },
        _count: { select: { enrollments: true } },
      },
    }),
    db.course.findMany({ where: { userId, catalogEntryId: { not: null } }, select: { id: true, catalogEntryId: true } }),
  ]);
  const have = new Map(mine.map((c) => [c.catalogEntryId!, c.id]));
  return entries.map((e) => ({
    id: e.id,
    title: e.title,
    subject: e.subject,
    description: e.description,
    license: e.license,
    attribution: e.attribution,
    sourceUrl: e.sourceUrl,
    published: e.published,
    hasCover: Boolean(e.coverKey),
    kind: e.sourceCourse.book.kind,
    pages: e.sourceCourse.book.pageCount ?? 0,
    lessons: e.sourceCourse._count.lessons,
    students: e._count.enrollments,
    myCourseId: have.get(e.id) ?? null,
  }));
}

export async function catalogCoverKey(entryId: string) {
  const e = await db.catalogEntry.findFirst({ where: { id: entryId, published: true }, select: { coverKey: true } });
  return e?.coverKey ?? null;
}

/**
 * Adds a provided course to a student's library: a full copy of the course
 * (book pages, search passages with their embeddings, outline, lessons,
 * questions, flashcards, tests), pointing at the shared catalog files.
 */
export async function enroll(userId: string, entryId: string): Promise<string> {
  const already = await db.course.findFirst({ where: { userId, catalogEntryId: entryId }, select: { id: true } });
  if (already) return already.id;
  const entry = await db.catalogEntry.findFirst({ where: { id: entryId, published: true }, select: { id: true, fileKey: true, coverKey: true, subject: true, sourceCourseId: true } });
  if (!entry) throw new NotFoundError("This course isn't available.");
  return copyCourseTo(userId, entry.sourceCourseId, { fileKey: entry.fileKey, coverKey: entry.coverKey, figuresPrefix: `${catalogPrefix(entry.id)}figures/` }, { catalogEntryId: entry.id, subject: entry.subject });
}
