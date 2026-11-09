import { classifyTitle } from "./front-back-matter";
import type { DraftLesson, DraftUnit, OutlineEntry } from "./types";

/**
 * Turns a flat list of headings into Units → Lessons with page ranges.
 *
 * Page ranges: a section runs until the next heading. If the next heading is
 * at the top of a page, this section ends on the page before; otherwise the
 * two sections share that page.
 */

export const MAX_LESSON_PAGES = 25; // longer lessons are split into parts
export const TARGET_PART_PAGES = 12;
export const FALLBACK_LESSON_PAGES = 10;

export type PageFlag = { pageNumber: number; frontBack: boolean };

function endBefore(next: OutlineEntry | undefined, fallbackEnd: number, start: number): number {
  if (!next) return fallbackEnd;
  return Math.max(start, next.startsAtTop ? next.page - 1 : next.page);
}

/** Split a long page range into roughly equal parts of about TARGET_PART_PAGES pages. */
export function splitRange(title: string, start: number, end: number, frontBack: boolean): DraftLesson[] {
  const length = end - start + 1;
  if (length <= MAX_LESSON_PAGES) return [{ title, pageStart: start, pageEnd: end, isFrontBackMatter: frontBack }];
  const parts = Math.ceil(length / TARGET_PART_PAGES);
  const size = Math.ceil(length / parts);
  const out: DraftLesson[] = [];
  for (let i = 0; i < parts; i++) {
    const s = start + i * size;
    const e = Math.min(end, s + size - 1);
    if (s > end) break;
    out.push({ title: `${title} (part ${i + 1} of ${parts})`, pageStart: s, pageEnd: e, isFrontBackMatter: frontBack });
  }
  return out;
}

/** Used when no outline can be found: fixed-size lessons grouped into units of ~10 lessons. */
export function pageRangeOutline(pageCount: number): DraftUnit[] {
  const lessons: DraftLesson[] = [];
  for (let s = 1; s <= pageCount; s += FALLBACK_LESSON_PAGES) {
    const e = Math.min(pageCount, s + FALLBACK_LESSON_PAGES - 1);
    lessons.push({ title: `Pages ${s}–${e}`, pageStart: s, pageEnd: e, isFrontBackMatter: false });
  }
  const units: DraftUnit[] = [];
  for (let i = 0; i < lessons.length; i += 10) {
    const group = lessons.slice(i, i + 10);
    units.push({
      title: `Part ${units.length + 1}`,
      pageStart: group[0].pageStart,
      pageEnd: group.at(-1)!.pageEnd,
      isFrontBackMatter: false,
      lessons: group,
    });
  }
  return units;
}

export function buildOutline(entries: OutlineEntry[], pageCount: number, pageFlags: PageFlag[] = []): DraftUnit[] {
  if (pageCount < 1) return [];
  const chapters = entries.filter((e) => e.level === 1);
  if (chapters.length === 0) return pageRangeOutline(pageCount);

  const flagged = new Set(pageFlags.filter((p) => p.frontBack).map((p) => p.pageNumber));
  const allFlagged = (s: number, e: number) => {
    for (let p = s; p <= e; p++) if (!flagged.has(p)) return false;
    return true;
  };

  const units: DraftUnit[] = [];

  // Pages before the first heading (title page, copyright…) become a front-matter unit.
  const frontEnd = entries[0].page - 1;
  if (frontEnd >= 1) {
    units.push({
      title: "Front matter",
      pageStart: 1,
      pageEnd: frontEnd,
      isFrontBackMatter: true,
      lessons: [{ title: "Front matter", pageStart: 1, pageEnd: frontEnd, isFrontBackMatter: true }],
    });
  }

  entries.forEach((entry, i) => {
    if (entry.level !== 1) return;
    const nextChapter = entries.slice(i + 1).find((e) => e.level === 1);
    const unitStart = entry.page;
    const unitEnd = endBefore(nextChapter, pageCount, unitStart);
    const kind = classifyTitle(entry.title);
    const unitFrontBack = kind !== null || allFlagged(unitStart, unitEnd);

    const sections = entries.slice(i + 1, nextChapter ? entries.indexOf(nextChapter) : undefined).filter((e) => e.level === 2);
    let lessons: DraftLesson[];
    if (sections.length === 0) {
      lessons = splitRange(entry.title, unitStart, unitEnd, unitFrontBack);
    } else {
      lessons = sections.flatMap((s, j) => {
        // The first lesson also covers the chapter's introduction before its first section.
        const start = j === 0 ? unitStart : s.page;
        const following = sections[j + 1] ?? nextChapter;
        const end = Math.min(unitEnd, endBefore(following, unitEnd, start));
        const lessonFrontBack = unitFrontBack || classifyTitle(s.title) !== null;
        return splitRange(s.title, start, end, lessonFrontBack);
      });
    }
    units.push({ title: entry.title, pageStart: unitStart, pageEnd: unitEnd, isFrontBackMatter: unitFrontBack, lessons });
  });

  return units;
}
