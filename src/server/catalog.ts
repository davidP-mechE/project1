import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { storage } from "./storage";
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
const baseName = (key: string) => key.slice(key.lastIndexOf("/") + 1);

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
  const prefix = catalogPrefix(id);
  const copy = async (from: string, to: string, type: string) => storage.put(to, await storage.getBuffer(from), type);
  await copy(course.book.storageKey, `${prefix}original.pdf`, "application/pdf");
  if (course.book.coverKey) await copy(course.book.coverKey, `${prefix}cover.jpg`, "image/jpeg");
  for (const f of course.book.figures) await copy(f.storageKey, `${prefix}figures/${baseName(f.storageKey)}`, "image/png");
  return db.catalogEntry.create({
    data: { id, sourceCourseId: course.id, fileKey: `${prefix}original.pdf`, coverKey: course.book.coverKey ? `${prefix}cover.jpg` : null, ...data },
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
  const entry = await db.catalogEntry.findFirst({
    where: { id: entryId, published: true },
    select: { id: true, fileKey: true, coverKey: true, subject: true, sourceCourse: { include: { book: true, units: true, lessons: true, flashcards: true, assessments: true } } },
  });
  if (!entry) throw new NotFoundError("This course isn't available.");
  const src = entry.sourceCourse;
  const questions = await db.question.findMany({ where: { courseId: src.id, scope: { in: ["LESSON", "UNIT_TEST", "FINAL_EXAM"] } } });
  const prefix = catalogPrefix(entry.id);

  return db.$transaction(
    async (tx) => {
      const book = await tx.book.create({
        data: {
          userId,
          kind: src.book.kind,
          originalFilename: src.book.originalFilename,
          storageKey: entry.fileKey,
          sizeBytes: src.book.sizeBytes,
          pageCount: src.book.pageCount,
          coverKey: entry.coverKey,
          status: "READY",
          rightsConfirmed: true,
          hasBuiltInOutline: src.book.hasBuiltInOutline,
        },
      });
      await tx.$executeRaw`
        INSERT INTO "Page" (id, "bookId", "pageNumber", label, text, "charCount", "textSource", "ocrConfidence", "mathScore", "imageCount", "isFrontBackMatter", lines, "repairedText", "repairedAt", width, height)
        SELECT gen_random_uuid()::text, ${book.id}, "pageNumber", label, text, "charCount", "textSource", "ocrConfidence", "mathScore", "imageCount", "isFrontBackMatter", lines, "repairedText", "repairedAt", width, height
        FROM "Page" WHERE "bookId" = ${src.bookId}`;
      await tx.$executeRaw`
        INSERT INTO "Figure" (id, "bookId", "pageNumber", index, "storageKey", width, height)
        SELECT gen_random_uuid()::text, ${book.id}, "pageNumber", index, ${`${prefix}figures/`} || regexp_replace("storageKey", '^.*/', ''), width, height
        FROM "Figure" WHERE "bookId" = ${src.bookId}`;
      await tx.$executeRaw`
        INSERT INTO "Chunk" (id, "bookId", ordinal, "pageStart", "pageEnd", text, "tokenCount", embedding, "embeddingModel")
        SELECT gen_random_uuid()::text, ${book.id}, ordinal, "pageStart", "pageEnd", text, "tokenCount", embedding, "embeddingModel"
        FROM "Chunk" WHERE "bookId" = ${src.bookId}`;

      const course = await tx.course.create({
        data: {
          userId,
          bookId: book.id,
          title: src.title,
          status: "ACTIVE",
          outlineSource: src.outlineSource,
          detectedOutline: (src.detectedOutline ?? undefined) as Prisma.InputJsonValue | undefined,
          settings: (src.settings ?? undefined) as Prisma.InputJsonValue | undefined,
          subject: entry.subject,
          catalogEntryId: entry.id,
          lastOpenedAt: new Date(),
        },
      });
      const unitIds = new Map(src.units.map((u) => [u.id, randomUUID()]));
      const lessonIds = new Map(src.lessons.map((l) => [l.id, randomUUID()]));
      const assessmentIds = new Map(src.assessments.map((a) => [a.id, randomUUID()]));
      await tx.unit.createMany({ data: src.units.map((u) => ({ id: unitIds.get(u.id)!, courseId: course.id, order: u.order, title: u.title, isFrontBackMatter: u.isFrontBackMatter })) });
      await tx.lesson.createMany({
        data: src.lessons.map((l) => ({
          id: lessonIds.get(l.id)!,
          unitId: unitIds.get(l.unitId)!,
          courseId: course.id,
          order: l.order,
          title: l.title,
          pageStart: l.pageStart,
          pageEnd: l.pageEnd,
          isFrontBackMatter: l.isFrontBackMatter,
          skip: l.skip,
          // Lessons still being written in the source course are left for later.
          status: l.content ? "READY" : l.status === "FLAGGED" ? "FLAGGED" : "PENDING",
          content: (l.content ?? undefined) as Prisma.InputJsonValue | undefined,
          cacheKey: l.cacheKey,
          model: l.model,
          promptVersion: l.promptVersion,
          generatedAt: l.generatedAt,
          flagReason: l.flagReason,
        })),
      });
      await tx.assessment.createMany({
        data: src.assessments.map((a) => ({
          id: assessmentIds.get(a.id)!,
          courseId: course.id,
          unitId: a.unitId ? unitIds.get(a.unitId)! : null,
          kind: a.kind,
          status: a.status === "READY" ? "READY" : "FAILED",
          error: a.status === "READY" ? null : "Not ready in the provided course yet.",
          summary: a.summary,
          model: a.model,
          generatedAt: a.generatedAt,
        })),
      });
      await tx.question.createMany({
        data: questions.map((q) => ({
          courseId: course.id,
          lessonId: q.lessonId ? (lessonIds.get(q.lessonId) ?? null) : null,
          assessmentId: q.assessmentId ? (assessmentIds.get(q.assessmentId) ?? null) : null,
          scope: q.scope,
          type: q.type,
          order: q.order,
          prompt: q.prompt,
          choices: q.choices,
          correctChoice: q.correctChoice,
          answer: q.answer,
          explanation: q.explanation,
          steps: q.steps,
          pageRefs: q.pageRefs,
          topic: q.topic,
        })),
      });
      await tx.flashcard.createMany({
        data: src.flashcards.map((f) => ({ courseId: course.id, lessonId: lessonIds.get(f.lessonId)!, order: f.order, front: f.front, back: f.back, pageRefs: f.pageRefs })),
      });
      return course.id;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
