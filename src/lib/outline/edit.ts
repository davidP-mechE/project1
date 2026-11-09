/**
 * Outline editing operations. Each function takes an outline and returns a NEW
 * outline (it never changes the one passed in). That makes undo trivial (keep
 * the old versions) and makes every operation easy to test on its own.
 *
 * `id` is the database id (missing for things the student just added).
 * `key` is a stable id for the browser UI, present on everything.
 */

import type { DraftUnit } from "./types";

export type EditableLesson = {
  key: string;
  id?: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  skip: boolean;
  isFrontBackMatter: boolean;
};
export type EditableUnit = { key: string; id?: string; title: string; isFrontBackMatter: boolean; lessons: EditableLesson[] };
export type EditableOutline = { units: EditableUnit[] };

export const MAX_TITLE = 200;
export const MAX_LESSONS = 600;
export const LONG_LESSON_PAGES = 40;

let counter = 0;
/** A unique key for new items (only needs to be unique within one editing session). */
export function newKey(prefix = "k"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

const clone = (o: EditableOutline): EditableOutline => ({
  units: o.units.map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l })) })),
});

function clampTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

function check(o: EditableOutline, ui: number, li?: number) {
  const unit = o.units[ui];
  if (!unit) throw new RangeError(`No unit at ${ui}`);
  if (li !== undefined && !unit.lessons[li]) throw new RangeError(`No lesson at ${ui}/${li}`);
}

/** Converts a detected outline (from processing) into an editable one. */
export function fromDraft(units: DraftUnit[]): EditableOutline {
  return {
    units: units.map((u) => ({
      key: newKey("u"),
      title: u.title,
      isFrontBackMatter: u.isFrontBackMatter,
      lessons: u.lessons.map((l) => ({
        key: newKey("l"),
        title: l.title,
        pageStart: l.pageStart,
        pageEnd: l.pageEnd,
        skip: l.isFrontBackMatter,
        isFrontBackMatter: l.isFrontBackMatter,
      })),
    })),
  };
}

// ─── Renaming ──────────────────────────────────────────────────────────────

export function renameUnit(o: EditableOutline, ui: number, title: string): EditableOutline {
  check(o, ui);
  const next = clone(o);
  next.units[ui].title = title.slice(0, MAX_TITLE);
  return next;
}

export function renameLesson(o: EditableOutline, ui: number, li: number, title: string): EditableOutline {
  check(o, ui, li);
  const next = clone(o);
  next.units[ui].lessons[li].title = title.slice(0, MAX_TITLE);
  return next;
}

// ─── Reordering ────────────────────────────────────────────────────────────

/**
 * Move a lesson up (-1) or down (+1). At the top/bottom of its unit it moves
 * into the end of the previous unit / start of the next unit.
 */
export function moveLesson(o: EditableOutline, ui: number, li: number, dir: -1 | 1): EditableOutline {
  check(o, ui, li);
  const next = clone(o);
  const lessons = next.units[ui].lessons;
  const target = li + dir;
  if (target >= 0 && target < lessons.length) {
    [lessons[li], lessons[target]] = [lessons[target], lessons[li]];
    return next;
  }
  const otherUnit = next.units[ui + dir];
  if (!otherUnit) return o; // already first/last in the whole course
  const [lesson] = lessons.splice(li, 1);
  if (dir === -1) otherUnit.lessons.push(lesson);
  else otherUnit.lessons.unshift(lesson);
  if (lessons.length === 0) next.units.splice(ui, 1); // don't leave an empty unit behind
  return next;
}

export function moveUnit(o: EditableOutline, ui: number, dir: -1 | 1): EditableOutline {
  check(o, ui);
  const target = ui + dir;
  if (target < 0 || target >= o.units.length) return o;
  const next = clone(o);
  [next.units[ui], next.units[target]] = [next.units[target], next.units[ui]];
  return next;
}

// ─── Merging & splitting ───────────────────────────────────────────────────

/** Combine a lesson with the one after it in the same unit. Keeps the first lesson's title and id. */
export function mergeLessonWithNext(o: EditableOutline, ui: number, li: number): EditableOutline {
  check(o, ui, li);
  if (li + 1 >= o.units[ui].lessons.length) return o;
  const next = clone(o);
  const lessons = next.units[ui].lessons;
  const [a, b] = [lessons[li], lessons[li + 1]];
  lessons.splice(li, 2, {
    ...a,
    pageStart: Math.min(a.pageStart, b.pageStart),
    pageEnd: Math.max(a.pageEnd, b.pageEnd),
    skip: a.skip && b.skip,
    isFrontBackMatter: a.isFrontBackMatter && b.isFrontBackMatter,
  });
  return next;
}

/**
 * Split a lesson into two at a page: the first part keeps pages up to
 * `atPage - 1`, the second part starts at `atPage`.
 */
export function splitLesson(o: EditableOutline, ui: number, li: number, atPage: number, secondTitle?: string): EditableOutline {
  check(o, ui, li);
  const lesson = o.units[ui].lessons[li];
  if (!Number.isInteger(atPage) || atPage <= lesson.pageStart || atPage > lesson.pageEnd) {
    throw new RangeError(`Split page must be between ${lesson.pageStart + 1} and ${lesson.pageEnd}.`);
  }
  const next = clone(o);
  const first = { ...lesson, pageEnd: atPage - 1 };
  const second: EditableLesson = {
    ...lesson,
    id: undefined,
    key: newKey("l"),
    title: clampTitle(secondTitle ?? `${lesson.title} (continued)`),
    pageStart: atPage,
  };
  next.units[ui].lessons.splice(li, 1, first, second);
  return next;
}

/** Append the next unit's lessons to this unit and remove the next unit. */
export function mergeUnitWithNext(o: EditableOutline, ui: number): EditableOutline {
  check(o, ui);
  if (ui + 1 >= o.units.length) return o;
  const next = clone(o);
  const [a, b] = [next.units[ui], next.units[ui + 1]];
  a.lessons.push(...b.lessons);
  a.isFrontBackMatter = a.isFrontBackMatter && b.isFrontBackMatter;
  next.units.splice(ui + 1, 1);
  return next;
}

/** Start a new unit at this lesson: it and every lesson after it move into a new unit. */
export function splitUnitAt(o: EditableOutline, ui: number, li: number, title = "New unit"): EditableOutline {
  check(o, ui, li);
  if (li === 0) return o;
  const next = clone(o);
  const moved = next.units[ui].lessons.splice(li);
  next.units.splice(ui + 1, 0, { key: newKey("u"), title: clampTitle(title), isFrontBackMatter: false, lessons: moved });
  return next;
}

// ─── Adding & deleting ─────────────────────────────────────────────────────

/** Add a one-page lesson after lesson `li` (or at the start if li = -1), starting after it. */
export function addLesson(o: EditableOutline, ui: number, li: number, pageCount: number, title = "New lesson"): EditableOutline {
  check(o, ui);
  const next = clone(o);
  const lessons = next.units[ui].lessons;
  const prev = lessons[li];
  const page = Math.min(pageCount, Math.max(1, prev ? prev.pageEnd : (lessons[0]?.pageStart ?? 1)));
  lessons.splice(li + 1, 0, {
    key: newKey("l"),
    title: clampTitle(title),
    pageStart: page,
    pageEnd: page,
    skip: false,
    isFrontBackMatter: false,
  });
  return next;
}

/** Add a unit (with one lesson) after unit `ui` (or at the start if ui = -1). */
export function addUnit(o: EditableOutline, ui: number, pageCount: number, title = "New unit"): EditableOutline {
  const next = clone(o);
  const prev = next.units[ui];
  const lastPage = prev?.lessons.at(-1)?.pageEnd ?? 1;
  const page = Math.min(pageCount, Math.max(1, lastPage));
  next.units.splice(ui + 1, 0, {
    key: newKey("u"),
    title: clampTitle(title),
    isFrontBackMatter: false,
    lessons: [{ key: newKey("l"), title: "New lesson", pageStart: page, pageEnd: page, skip: false, isFrontBackMatter: false }],
  });
  return next;
}

export function deleteLesson(o: EditableOutline, ui: number, li: number): EditableOutline {
  check(o, ui, li);
  const next = clone(o);
  next.units[ui].lessons.splice(li, 1);
  if (next.units[ui].lessons.length === 0) next.units.splice(ui, 1);
  return next;
}

export function deleteUnit(o: EditableOutline, ui: number): EditableOutline {
  check(o, ui);
  const next = clone(o);
  next.units.splice(ui, 1);
  return next;
}

// ─── Page ranges & skipping ────────────────────────────────────────────────

export function setLessonRange(o: EditableOutline, ui: number, li: number, pageStart: number, pageEnd: number): EditableOutline {
  check(o, ui, li);
  const current = o.units[ui].lessons[li];
  if (current.pageStart === pageStart && current.pageEnd === pageEnd) return o; // no change, no Undo step
  const next = clone(o);
  Object.assign(next.units[ui].lessons[li], { pageStart, pageEnd });
  return next;
}

export function setLessonSkip(o: EditableOutline, ui: number, li: number, skip: boolean): EditableOutline {
  check(o, ui, li);
  const next = clone(o);
  next.units[ui].lessons[li].skip = skip;
  return next;
}

export function setUnitSkip(o: EditableOutline, ui: number, skip: boolean): EditableOutline {
  check(o, ui);
  const next = clone(o);
  for (const l of next.units[ui].lessons) l.skip = skip;
  return next;
}

/** Include or skip every front/back-matter lesson at once (the course setting). */
export function setFrontBackMatterIncluded(o: EditableOutline, include: boolean): EditableOutline {
  const next = clone(o);
  for (const u of next.units) for (const l of u.lessons) if (l.isFrontBackMatter) l.skip = !include;
  return next;
}

export const isUnitSkipped = (u: EditableUnit) => u.lessons.length > 0 && u.lessons.every((l) => l.skip);

// ─── Validation ────────────────────────────────────────────────────────────

export type OutlineIssue = { message: string; unitKey?: string; lessonKey?: string };
export type OutlineCheck = { errors: OutlineIssue[]; warnings: OutlineIssue[] };

/**
 * Errors block saving (they'd break lesson generation). Warnings are shown but
 * allowed: e.g. pages that no lesson covers might be intentional.
 */
export function validateOutline(o: EditableOutline, pageCount: number): OutlineCheck {
  const errors: OutlineIssue[] = [];
  const warnings: OutlineIssue[] = [];
  const lessons = o.units.flatMap((u) => u.lessons.map((l) => ({ u, l })));

  if (o.units.length === 0) errors.push({ message: "The course needs at least one unit." });
  if (lessons.length > MAX_LESSONS) errors.push({ message: `A course can have at most ${MAX_LESSONS} lessons.` });
  if (lessons.length > 0 && lessons.every(({ l }) => l.skip)) {
    errors.push({ message: "Every lesson is skipped. Include at least one lesson." });
  }

  for (const u of o.units) {
    if (!u.title.trim()) errors.push({ message: "A unit has no title.", unitKey: u.key });
    if (u.lessons.length === 0) errors.push({ message: `Unit "${u.title || "Untitled"}" has no lessons.`, unitKey: u.key });
  }
  for (const { u, l } of lessons) {
    const name = l.title.trim() || "Untitled lesson";
    if (!l.title.trim()) errors.push({ message: `A lesson in "${u.title || "Untitled"}" has no title.`, unitKey: u.key, lessonKey: l.key });
    if (!Number.isInteger(l.pageStart) || !Number.isInteger(l.pageEnd)) {
      errors.push({ message: `"${name}": page numbers must be whole numbers.`, unitKey: u.key, lessonKey: l.key });
      continue;
    }
    if (l.pageStart < 1 || l.pageEnd > pageCount) {
      errors.push({ message: `"${name}": pages must be between 1 and ${pageCount}.`, unitKey: u.key, lessonKey: l.key });
    } else if (l.pageStart > l.pageEnd) {
      errors.push({ message: `"${name}": the first page comes after the last page.`, unitKey: u.key, lessonKey: l.key });
    } else if (!l.skip && l.pageEnd - l.pageStart + 1 > LONG_LESSON_PAGES) {
      warnings.push({
        message: `"${name}" covers ${l.pageEnd - l.pageStart + 1} pages. Long lessons are harder to study; consider splitting it.`,
        unitKey: u.key,
        lessonKey: l.key,
      });
    }
  }

  // Pages that no included lesson covers (excluding pages only covered by skipped lessons).
  if (errors.length === 0) {
    const covered = new Set<number>();
    const anyLesson = new Set<number>();
    for (const { l } of lessons) {
      for (let p = l.pageStart; p <= l.pageEnd; p++) {
        anyLesson.add(p);
        if (!l.skip) covered.add(p);
      }
    }
    const missing: number[] = [];
    for (let p = 1; p <= pageCount; p++) if (!anyLesson.has(p)) missing.push(p);
    if (missing.length > 0) {
      warnings.push({ message: `No lesson covers ${missing.length === 1 ? "page" : "pages"} ${formatPages(missing)}.` });
    }
  }
  return { errors, warnings };
}

/** [3,4,5,9] -> "3–5, 9" (long lists are shortened). */
export function formatPages(pages: number[], max = 8): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return parts.length > max ? `${parts.slice(0, max).join(", ")} and more` : parts.join(", ");
}

/** Remove UI-only fields and tidy titles before saving. */
export function normalizeForSave(o: EditableOutline): EditableOutline {
  return {
    units: o.units.map((u) => ({
      ...u,
      title: clampTitle(u.title),
      lessons: u.lessons.map((l) => ({ ...l, title: clampTitle(l.title) })),
    })),
  };
}
