import { createHash } from "node:crypto";
import type { CourseSettings } from "@/lib/course/settings";
import { MATH_HEAVY_THRESHOLD } from "@/lib/pdf/math-score";

/**
 * Checks on a lesson's source pages BEFORE spending money on generation,
 * plus the cache key that decides whether a lesson needs regenerating.
 */

export type SourcePage = {
  pageNumber: number;
  label: string | null;
  text: string;
  textSource: "NATIVE" | "OCR" | "NONE";
  mathScore: number;
  repairedText: string | null;
  /** The model that re-read the page from its image (null: read before this was recorded). */
  repairModel?: string | null;
  imageCount?: number;
};

/** Slides carry far less text than book pages, so a lesson needs less to work from. */
export const MIN_SLIDE_SOURCE_CHARS = 60;

export const MIN_SOURCE_CHARS = 250;

/** The best text we have for a page: the vision re-read if there is one. */
export const pageText = (p: SourcePage) => (p.repairedText ?? p.text).trim();

/** Max characters on a slide for it to be re-read from its image when it has pictures. */
export const SLIDE_READ_MAX_CHARS = 400;

/**
 * Pages worth re-reading from their image: equation-heavy book pages, and
 * slides that are mostly pictures (diagrams and charts carry the content).
 */
export function needsRepair(p: SourcePage, kind: "book" | "slides" = "book"): boolean {
  if (p.repairedText !== null) return false;
  // Slides with pictures and little text (diagrams, charts, or slides exported as one big image).
  if (kind === "slides") return (p.imageCount ?? 0) > 0 && p.text.trim().length < SLIDE_READ_MAX_CHARS;
  return p.mathScore >= MATH_HEAVY_THRESHOLD;
}

export type SourceAssessment = { ok: true; chars: number } | { ok: false; reason: string };

/**
 * Flag lessons whose pages don't have enough readable text, instead of
 * letting the model guess. The model can still flag a lesson itself later
 * (sourceCheck.usable = false) if the text is there but unusable.
 */
export function assessSource(pages: SourcePage[], kind: "book" | "slides" = "book"): SourceAssessment {
  const chars = pages.reduce((n, p) => n + pageText(p).replace(/\s/g, "").length, 0);
  if (pages.length === 0) return { ok: false, reason: "This lesson has no pages." };
  if (kind === "slides") {
    if (chars >= MIN_SLIDE_SOURCE_CHARS) return { ok: true, chars };
    return {
      ok: false,
      reason: `These slides have almost no text (${chars} characters), even after reading their pictures. Merge this lesson with a neighbour in the outline, or skip it.`,
    };
  }
  if (chars < MIN_SOURCE_CHARS) {
    return {
      ok: false,
      reason: `These pages have almost no text (${chars} characters). They may be a chapter title page, a full-page figure, or a scan that couldn't be read. Check the page range in the outline, merge this lesson with a neighbour, or skip it.`,
    };
  }
  const empty = pages.filter((p) => pageText(p).length < 40).length;
  if (pages.length >= 3 && empty / pages.length > 0.6) {
    return {
      ok: false,
      reason: `${empty} of this lesson's ${pages.length} pages have no readable text (they may be images or figures). A lesson written from the rest would leave too much out.`,
    };
  }
  return { ok: true, chars };
}

/** Pages as the model sees them, each with a marker it can cite. */
export function formatSourcePages(pages: SourcePage[]): string {
  return pages
    .map((p) => {
      const printed = p.label && p.label !== String(p.pageNumber) ? ` (printed page number ${p.label})` : "";
      const text = pageText(p) || "[No readable text on this page]";
      return `=== Page ${p.pageNumber}${printed} ===\n${text}`;
    })
    .join("\n\n");
}

/** Settings that change what a lesson looks like (others, like front/back matter, don't). */
export function settingsForCache(s: CourseSettings) {
  return {
    level: s.level,
    style: s.style,
    contentTypes: [...s.contentTypes].sort(),
    questionsPerLesson: s.questionsPerLesson,
    flashcardsPerLesson: s.flashcardsPerLesson,
  };
}

export function lessonCacheKey(input: {
  promptVersion: string;
  model: string;
  effort: string;
  settings: CourseSettings;
  courseTitle: string;
  unitTitle: string;
  lessonTitle: string;
  pages: SourcePage[];
}): string {
  const payload = JSON.stringify({
    v: input.promptVersion,
    model: input.model,
    effort: input.effort,
    settings: settingsForCache(input.settings),
    course: input.courseTitle,
    unit: input.unitTitle,
    lesson: input.lessonTitle,
    pages: input.pages.map((p) => [p.pageNumber, pageText(p)]),
  });
  return createHash("sha256").update(payload).digest("hex");
}
