import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { storage } from "./storage";

/**
 * Giving a student their own copy of someone else's course: the Hub (provided
 * courses) and classes (a teacher's assigned course). The outline, lessons,
 * questions, flashcards and tests are copied, so the student's progress,
 * notes and edits are theirs. The book's files are a snapshot shared by every
 * copy, kept under its own prefix so copies keep working if the original
 * course changes or is deleted. Nothing is sent to Claude.
 */

export type CourseFiles = { fileKey: string; coverKey: string | null; figuresPrefix: string };

const baseName = (key: string) => key.slice(key.lastIndexOf("/") + 1);

/** Copy a book's PDF, cover and figures to `prefix` (e.g. catalog/<id>/). */
export async function snapshotFiles(book: { storageKey: string; coverKey: string | null; figures: { storageKey: string }[] }, prefix: string): Promise<CourseFiles> {
  const copy = async (from: string, to: string, type: string) => storage.put(to, await storage.getBuffer(from), type);
  await copy(book.storageKey, `${prefix}original.pdf`, "application/pdf");
  if (book.coverKey) await copy(book.coverKey, `${prefix}cover.jpg`, "image/jpeg");
  for (const f of book.figures) await copy(f.storageKey, `${prefix}figures/${baseName(f.storageKey)}`, "image/png");
  return { fileKey: `${prefix}original.pdf`, coverKey: book.coverKey ? `${prefix}cover.jpg` : null, figuresPrefix: `${prefix}figures/` };
}

/** Make `userId` their own copy of a course, pointing at shared snapshot files. Returns the new course id. */
export async function copyCourseTo(
  userId: string,
  sourceCourseId: string,
  files: CourseFiles,
  link: { catalogEntryId?: string; classCourseId?: string; subject?: string | null; title?: string },
): Promise<string> {
  const src = await db.course.findUniqueOrThrow({
    where: { id: sourceCourseId },
    include: { book: true, units: true, lessons: true, flashcards: true, assessments: true },
  });
  const questions = await db.question.findMany({ where: { courseId: src.id, scope: { in: ["LESSON", "UNIT_TEST", "FINAL_EXAM"] } } });

  return db.$transaction(
    async (tx) => {
      const book = await tx.book.create({
        data: {
          userId,
          kind: src.book.kind,
          originalFilename: src.book.originalFilename,
          storageKey: files.fileKey,
          sizeBytes: src.book.sizeBytes,
          pageCount: src.book.pageCount,
          coverKey: files.coverKey,
          status: "READY",
          rightsConfirmed: true,
          hasBuiltInOutline: src.book.hasBuiltInOutline,
        },
      });
      await tx.$executeRaw`
        INSERT INTO "Page" (id, "bookId", "pageNumber", label, text, "charCount", "textSource", "ocrConfidence", "mathScore", "imageCount", "isFrontBackMatter", lines, "repairedText", "repairedAt", "repairModel", width, height)
        SELECT gen_random_uuid()::text, ${book.id}, "pageNumber", label, text, "charCount", "textSource", "ocrConfidence", "mathScore", "imageCount", "isFrontBackMatter", lines, "repairedText", "repairedAt", "repairModel", width, height
        FROM "Page" WHERE "bookId" = ${src.bookId}`;
      await tx.$executeRaw`
        INSERT INTO "Figure" (id, "bookId", "pageNumber", index, "storageKey", width, height)
        SELECT gen_random_uuid()::text, ${book.id}, "pageNumber", index, ${files.figuresPrefix} || regexp_replace("storageKey", '^.*/', ''), width, height
        FROM "Figure" WHERE "bookId" = ${src.bookId}`;
      await tx.$executeRaw`
        INSERT INTO "Chunk" (id, "bookId", ordinal, "pageStart", "pageEnd", text, "tokenCount", embedding, "embeddingModel")
        SELECT gen_random_uuid()::text, ${book.id}, ordinal, "pageStart", "pageEnd", text, "tokenCount", embedding, "embeddingModel"
        FROM "Chunk" WHERE "bookId" = ${src.bookId}`;

      const course = await tx.course.create({
        data: {
          userId,
          bookId: book.id,
          title: link.title ?? src.title,
          status: "ACTIVE",
          outlineSource: src.outlineSource,
          detectedOutline: (src.detectedOutline ?? undefined) as Prisma.InputJsonValue | undefined,
          settings: (src.settings ?? undefined) as Prisma.InputJsonValue | undefined,
          subject: link.subject ?? src.subject,
          catalogEntryId: link.catalogEntryId ?? null,
          classCourseId: link.classCourseId ?? null,
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
          sourceLessonId: l.id,
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
          error: a.status === "READY" ? null : "Not ready in the original course yet.",
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
