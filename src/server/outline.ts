import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { recomputeCourseProgress } from "./study";
import { MATH_HEAVY_THRESHOLD } from "@/lib/pdf/math-score";
import { SLIDE_READ_MAX_CHARS } from "@/lib/ai/source";
import { courseSettingsSchema, parseSettings, type CourseSettings } from "@/lib/course/settings";
import {
  fromDraft,
  MAX_LESSONS,
  MAX_TITLE,
  normalizeForSave,
  validateOutline,
  type EditableOutline,
  type OutlineIssue,
} from "@/lib/outline/edit";
import type { DraftUnit } from "@/lib/outline/types";
import { env } from "./env";
import { estimateGeneration, planFor, type EstimateLesson } from "@/lib/usage/estimate";

/**
 * Loading and saving a course's outline and settings. Like everything in
 * src/server, every function takes the current user's id and only touches
 * that user's data.
 */

/** Pages the lesson writer will re-read from their image (costs a vision call), as in src/lib/ai/source.ts. */
function rereadFromImage(p: { charCount: number; mathScore: number; imageCount: number }, kind: "BOOK" | "SLIDES", repairedText: string | null) {
  if (repairedText) return false;
  if (kind === "SLIDES") return p.imageCount > 0 && p.charCount < SLIDE_READ_MAX_CHARS;
  return p.mathScore >= MATH_HEAVY_THRESHOLD;
}

const EDITABLE_STATUSES = ["OUTLINE_DRAFT", "ACTIVE"] as const;

export class OutlineLockedError extends Error {}
export class OutlineInvalidError extends Error {
  constructor(readonly issues: OutlineIssue[]) {
    super(issues[0]?.message ?? "Invalid outline");
  }
}

async function loadCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: {
      id: true,
      title: true,
      status: true,
      bookId: true,
      settings: true,
      detectedOutline: true,
      outlineSource: true,
      book: { select: { pageCount: true, kind: true } },
    },
  });
  if (!course) throw new NotFoundError("Course not found");
  return course;
}

export function isOutlineEditable(status: string) {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** Everything the outline editor needs. Database ids double as the editor's keys. */
export async function getOutlineForEditing(userId: string, courseId: string) {
  const course = await loadCourse(userId, courseId);
  const units = await db.unit.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  const outline: EditableOutline = {
    units: units.map((u) => ({
      key: u.id,
      id: u.id,
      title: u.title,
      isFrontBackMatter: u.isFrontBackMatter,
      lessons: u.lessons.map((l) => ({
        key: l.id,
        id: l.id,
        title: l.title,
        pageStart: l.pageStart,
        pageEnd: l.pageEnd,
        skip: l.skip,
        isFrontBackMatter: l.isFrontBackMatter,
      })),
    })),
  };
  return {
    course: { id: course.id, title: course.title, status: course.status, outlineSource: course.outlineSource },
    pageCount: course.book.pageCount ?? 0,
    editable: isOutlineEditable(course.status),
    outline,
    detected: Array.isArray(course.detectedOutline) ? fromDraft(course.detectedOutline as unknown as DraftUnit[]) : null,
  };
}

// What the browser is allowed to send. Ids are checked against the database before use.
const lessonInput = z.object({
  key: z.string().min(1).max(100),
  id: z.string().min(1).max(64).optional(),
  title: z.string().max(MAX_TITLE * 2),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  skip: z.boolean(),
  isFrontBackMatter: z.boolean(),
});
const outlineInput = z.object({
  units: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        id: z.string().min(1).max(64).optional(),
        title: z.string().max(MAX_TITLE * 2),
        isFrontBackMatter: z.boolean(),
        lessons: z.array(lessonInput).max(MAX_LESSONS),
      }),
    )
    .max(MAX_LESSONS),
});

/**
 * Save an edited outline. Instead of deleting everything and starting over,
 * we compare with what's stored: kept lessons keep their database id (and,
 * from Phase 4 on, their generated content), new ones are created, removed
 * ones are deleted.
 */
export async function saveOutline(userId: string, courseId: string, input: unknown) {
  const course = await loadCourse(userId, courseId);
  if (!isOutlineEditable(course.status)) {
    throw new OutlineLockedError("The outline can't be changed right now.");
  }
  const parsed = outlineInput.safeParse(input);
  if (!parsed.success) throw new OutlineInvalidError([{ message: "The outline couldn't be read. Please reload the page." }]);
  const draft = normalizeForSave(parsed.data);
  const pageCount = course.book.pageCount ?? 0;
  const { errors } = validateOutline(draft, pageCount);
  if (errors.length > 0) throw new OutlineInvalidError(errors);

  const existingUnits = await db.unit.findMany({ where: { courseId }, select: { id: true } });
  const existingLessons = await db.lesson.findMany({
    where: { courseId },
    select: { id: true, title: true, pageStart: true, pageEnd: true },
  });
  const unitIds = new Set(existingUnits.map((u) => u.id));
  const lessonById = new Map(existingLessons.map((l) => [l.id, l]));

  // Ignore ids that aren't this course's (a tampered request can't touch other data).
  for (const u of draft.units) {
    if (u.id && !unitIds.has(u.id)) u.id = undefined;
    for (const l of u.lessons) if (l.id && !lessonById.has(l.id)) l.id = undefined;
  }
  // An id may only be used once (e.g. if a lesson was duplicated by a buggy client).
  const seen = new Set<string>();
  for (const l of draft.units.flatMap((u) => u.lessons)) {
    if (l.id && seen.has(l.id)) l.id = undefined;
    if (l.id) seen.add(l.id);
  }
  // A "new" lesson identical to a removed one (e.g. after "Reset to detected outline")
  // takes over the removed lesson's id, so its content isn't thrown away.
  const sig = (l: { title: string; pageStart: number; pageEnd: number }) => `${l.title}\u0000${l.pageStart}\u0000${l.pageEnd}`;
  const removedBySig = new Map(existingLessons.filter((l) => !seen.has(l.id)).map((l) => [sig(l), l.id]));
  for (const l of draft.units.flatMap((u) => u.lessons)) {
    if (!l.id && removedBySig.has(sig(l))) {
      l.id = removedBySig.get(sig(l));
      removedBySig.delete(sig(l));
      seen.add(l.id!);
    }
  }

  await db.$transaction(async (tx) => {
    const keptUnits = new Set<string>();
    const keptLessons = new Set<string>();
    for (const [order, u] of draft.units.entries()) {
      const unitData = {
        order,
        title: u.title,
        isFrontBackMatter: u.lessons.every((l) => l.isFrontBackMatter),
      };
      const unitId = u.id
        ? (await tx.unit.update({ where: { id: u.id }, data: unitData, select: { id: true } })).id
        : (await tx.unit.create({ data: { courseId, ...unitData }, select: { id: true } })).id;
      keptUnits.add(unitId);

      for (const [i, l] of u.lessons.entries()) {
        const data = {
          unitId,
          order: i,
          title: l.title,
          pageStart: l.pageStart,
          pageEnd: l.pageEnd,
          skip: l.skip,
          isFrontBackMatter: l.isFrontBackMatter,
        };
        if (l.id) {
          const before = lessonById.get(l.id)!;
          const rangeChanged = before.pageStart !== l.pageStart || before.pageEnd !== l.pageEnd;
          await tx.lesson.update({
            where: { id: l.id },
            // Different pages means any generated content is out of date.
            data: rangeChanged ? { ...data, status: "PENDING" } : data,
          });
          keptLessons.add(l.id);
        } else {
          const created = await tx.lesson.create({ data: { courseId, ...data }, select: { id: true } });
          keptLessons.add(created.id);
        }
      }
    }
    await tx.lesson.deleteMany({ where: { courseId, id: { notIn: [...keptLessons] } } });
    await tx.unit.deleteMany({ where: { courseId, id: { notIn: [...keptUnits] } } });
  });
  // Lessons may have been added, removed or skipped, which changes "% complete".
  await recomputeCourseProgress(userId, courseId);

  return getOutlineForEditing(userId, courseId);
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function getSettings(userId: string, courseId: string): Promise<CourseSettings> {
  const course = await loadCourse(userId, courseId);
  return parseSettings(course.settings);
}

/** Save settings. Changing "include front/back matter" also includes/skips those lessons. */
export async function saveSettings(userId: string, courseId: string, input: unknown): Promise<CourseSettings> {
  const course = await loadCourse(userId, courseId);
  if (!isOutlineEditable(course.status)) throw new OutlineLockedError("Settings can't be changed right now.");
  const parsed = courseSettingsSchema.safeParse(input);
  if (!parsed.success) throw new OutlineInvalidError([{ message: "Some settings weren't valid. Please check the form." }]);
  const settings = parsed.data;
  const before = parseSettings(course.settings);
  await db.$transaction([
    db.course.update({ where: { id: courseId }, data: { settings: settings as unknown as Prisma.InputJsonValue } }),
    ...(before.includeFrontBackMatter !== settings.includeFrontBackMatter
      ? [
          db.lesson.updateMany({
            where: { courseId, isFrontBackMatter: true },
            data: { skip: !settings.includeFrontBackMatter },
          }),
        ]
      : []),
  ]);
  if (before.includeFrontBackMatter !== settings.includeFrontBackMatter) await recomputeCourseProgress(userId, courseId);
  return settings;
}

/** Numbers for the cost/time estimate: included lessons with their text size and equation-heavy pages. */
export async function getEstimateInputs(userId: string, courseId: string) {
  const course = await loadCourse(userId, courseId);
  const [lessons, pages] = await Promise.all([
    db.lesson.findMany({
      where: { courseId },
      select: { unitId: true, pageStart: true, pageEnd: true, skip: true, isFrontBackMatter: true },
      orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    }),
    db.page.findMany({ where: { bookId: course.bookId }, select: { pageNumber: true, charCount: true, mathScore: true, imageCount: true } }),
  ]);
  const byPage = new Map(pages.map((p) => [p.pageNumber, p]));
  const toInput = (l: (typeof lessons)[number]): EstimateLesson => {
    let chars = 0;
    let math = 0;
    for (let n = l.pageStart; n <= l.pageEnd; n++) {
      const p = byPage.get(n);
      chars += p?.charCount ?? 0;
      if (p && rereadFromImage(p, course.book.kind, null)) math += 1;
    }
    return { unitKey: l.unitId, pages: l.pageEnd - l.pageStart + 1, chars, mathHeavyPages: math };
  };
  // Both lists are sent so the settings page can update the estimate instantly
  // when "include front/back matter" is toggled.
  return {
    normal: lessons.filter((l) => !l.isFrontBackMatter && !l.skip).map(toInput),
    frontBack: lessons.filter((l) => l.isFrontBackMatter).map(toInput),
    skippedNormal: lessons.filter((l) => l.skip && !l.isFrontBackMatter).length,
  };
}

/**
 * Cost/time estimate for the lessons a "Generate" click would write:
 * "pending" = included lessons with no content yet; "all" = every included lesson.
 */
export async function getGenerationEstimate(userId: string, courseId: string, which: "pending" | "all" | { lessonIds: string[] }) {
  const course = await loadCourse(userId, courseId);
  const settings = parseSettings(course.settings);
  const [lessons, pages] = await Promise.all([
    db.lesson.findMany({
      where: {
        courseId,
        ...(typeof which === "object"
          ? { id: { in: which.lessonIds } }
          : { skip: false, ...(which === "pending" ? { generatedAt: null, status: { in: ["PENDING", "FAILED"] } } : {}) }),
      },
      select: { unitId: true, pageStart: true, pageEnd: true },
    }),
    db.page.findMany({ where: { bookId: course.bookId }, select: { pageNumber: true, charCount: true, mathScore: true, repairedText: true, imageCount: true } }),
  ]);
  const byPage = new Map(pages.map((p) => [p.pageNumber, p]));
  const inputs: EstimateLesson[] = lessons.map((l) => {
    let chars = 0;
    let math = 0;
    for (let n = l.pageStart; n <= l.pageEnd; n++) {
      const p = byPage.get(n);
      chars += p?.charCount ?? 0;
      // Pages already re-read from an image don't cost anything extra.
      if (p && rereadFromImage(p, course.book.kind, p.repairedText)) math += 1;
    }
    return { unitKey: l.unitId, pages: l.pageEnd - l.pageStart + 1, chars, mathHeavyPages: math };
  });
  // Unit tests, summaries and the final exam come in a later phase; estimate lessons only for now.
  return estimateGeneration(
    inputs,
    { ...settings, contentTypes: settings.contentTypes.filter((t) => !["unitSummaries", "unitTests", "finalExam"].includes(t)) },
    planFor(settings, env.CLAUDE_BATCH_GENERATION),
  );
}

// ─── Page preview ───────────────────────────────────────────────────────────

/** First and last words of a page, so students can check where a lesson starts and ends. */
export async function getPagePreview(userId: string, courseId: string, pageNumber: number) {
  const course = await loadCourse(userId, courseId);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > (course.book.pageCount ?? 0)) {
    throw new NotFoundError("Page not found");
  }
  const page = await db.page.findUnique({
    where: { bookId_pageNumber: { bookId: course.bookId, pageNumber } },
    select: { pageNumber: true, label: true, text: true, textSource: true },
  });
  if (!page) throw new NotFoundError("Page not found");
  const flat = page.text.replace(/\s+/g, " ").trim();
  const SNIP = 140;
  return {
    pageNumber: page.pageNumber,
    label: page.label,
    textSource: page.textSource,
    start: flat.slice(0, SNIP),
    end: flat.length > SNIP * 2 ? flat.slice(-SNIP) : "",
    empty: flat.length === 0,
  };
}
