import "server-only";
import { z } from "zod";
import { db } from "./db";
import { storage, storageKeys } from "./storage";
import { publishCourse } from "./catalog";
import { sanitizeSlideHtml } from "@/lib/slides/sanitize";
import { SLIDE_LESSON_MODEL } from "@/lib/slides/constants";
import type { LessonContent } from "@/lib/ai/lesson-schema";
import { isSubjectId } from "@/lib/subjects";

/**
 * Adds a course made from lesson slide decks to the Hub (for example The 1600
 * Project's "SAT Math" and "SAT EBRW", in content/hub/). The course belongs to
 * a site admin, like any Hub course, and is published straight away. Each deck
 * is one lesson that shows its slides; the course's PDF holds every slide, one
 * per page, so "See the slides" and the page links work as for any slide course.
 * Nothing is sent to Claude. Importing the same course again does nothing.
 */

const SlideSchema = z.object({ id: z.string().min(1).max(80), html: z.string().min(1).max(80_000), text: z.string().max(20_000) });
const LessonSchema = z.object({ title: z.string().min(1).max(200), pageStart: z.number().int().min(1), pageEnd: z.number().int().min(1), slides: z.array(SlideSchema).min(1).max(80) });
export const SlideCourseSchema = z.object({
  version: z.literal(1),
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  title: z.string().min(1).max(120),
  subject: z.string().refine(isSubjectId, "Unknown subject"),
  description: z.string().min(1).max(600),
  pageCount: z.number().int().min(1).max(2000),
  units: z.array(z.object({ title: z.string().min(1).max(200), lessons: z.array(LessonSchema).min(1).max(60) })).min(1).max(40),
});
export type SlideCourse = z.infer<typeof SlideCourseSchema>;

export const HUB_LICENSE = "© The 1600 Project. All rights reserved.";
export const HUB_ATTRIBUTION = "Lesson slides by The 1600 Project, shared on Coursebook for its students.";

const escapeMd = (s: string) => s.replace(/([\\`*_{}[\]<>#|$~])/g, "\\$1");

/** The text version of a lesson's slides (search, the tutor, screen readers and small screens). */
export function slidesToMarkdown(slides: { text: string }[]) {
  return slides
    .map((s, i) => {
      const lines = s.text.split("\n").map((l) => l.trim()).filter(Boolean).map(escapeMd);
      return `### Slide ${i + 1}\n\n${lines.join("  \n") || "_(no text)_"}`;
    })
    .join("\n\n")
    .slice(0, 60_000);
}

/** Who owns imported Hub courses: the given site admin, or the first one. */
export async function hubOwner(email?: string) {
  const admin = await db.user.findFirst({
    where: { role: "ADMIN", ...(email ? { email: email.toLowerCase() } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error(email ? `No site admin with the email ${email}. Make them one with npm run admin:grant first.` : "There's no site admin yet. Make one with npm run admin:grant -- you@example.com first.");
  return admin;
}

export async function importSlideCourse(ownerId: string, input: unknown, pdf: Buffer) {
  const data = SlideCourseSchema.parse(input);
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file isn't a PDF.");
  const filename = `${data.key}.pdf`;
  const existing = await db.course.findFirst({
    where: { userId: ownerId, title: data.title, book: { originalFilename: filename }, publishedAs: { isNot: null } },
    select: { id: true, publishedAs: { select: { id: true } } },
  });
  if (existing) return { status: "exists" as const, courseId: existing.id, entryId: existing.publishedAs!.id };

  const pages = data.units.flatMap((u) => u.lessons.flatMap((l) => l.slides));
  if (pages.length !== data.pageCount) throw new Error(`The course lists ${pages.length} slides but says it has ${data.pageCount} pages.`);

  const book = await db.book.create({
    data: { userId: ownerId, kind: "SLIDES", originalFilename: filename, storageKey: `pending-${crypto.randomUUID()}`, sizeBytes: BigInt(pdf.length), pageCount: data.pageCount, status: "READY", rightsConfirmed: true, hasBuiltInOutline: true },
  });
  const storageKey = storageKeys.bookOriginal(ownerId, book.id);
  await storage.put(storageKey, pdf, "application/pdf");

  const courseId = await db.$transaction(
    async (tx) => {
      await tx.book.update({ where: { id: book.id }, data: { storageKey } });
      await tx.page.createMany({ data: pages.map((s, i) => ({ bookId: book.id, pageNumber: i + 1, text: s.text, charCount: s.text.length, width: 1920, height: 1080 })) });
      const course = await tx.course.create({ data: { userId: ownerId, bookId: book.id, title: data.title, status: "ACTIVE", subject: data.subject, outlineSource: "SLIDES" } });
      for (const [ui, u] of data.units.entries()) {
        const unit = await tx.unit.create({ data: { courseId: course.id, order: ui, title: u.title } });
        for (const [li, l] of u.lessons.entries()) {
          const content: LessonContent = {
            objectives: [],
            explanation: slidesToMarkdown(l.slides),
            workedExamples: [],
            keyTerms: [],
            slides: l.slides.map((s) => ({ id: s.id, html: sanitizeSlideHtml(s.html) })),
          };
          await tx.lesson.create({
            data: { unitId: unit.id, courseId: course.id, order: li, title: l.title, pageStart: l.pageStart, pageEnd: l.pageEnd, status: "READY", content, model: SLIDE_LESSON_MODEL, generatedAt: new Date() },
          });
        }
      }
      return course.id;
    },
    { timeout: 60_000 },
  );

  const entry = await publishCourse(courseId, { description: data.description, subject: data.subject as never, license: HUB_LICENSE, attribution: HUB_ATTRIBUTION });
  return { status: "created" as const, courseId, entryId: entry.id, lessons: data.units.reduce((n, u) => n + u.lessons.length, 0), slides: pages.length };
}
