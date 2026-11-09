import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { MAX_HIGHLIGHT_CHARS, CONTEXT_CHARS } from "@/lib/highlights/anchor";
import type { HighlightColor } from "@/generated/prisma/client";

/** Highlights and notes. Every function checks the lesson/course belongs to the student. */

export class NotesError extends Error {}

export const HIGHLIGHT_COLORS = ["YELLOW", "GREEN", "BLUE", "PINK"] as const satisfies readonly HighlightColor[];
export const MAX_NOTE_CHARS = 20_000;
const MAX_HIGHLIGHTS_PER_LESSON = 300;

const isColor = (c: unknown): c is HighlightColor => typeof c === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(c);

async function ownedLesson(userId: string, lessonId: string) {
  const lesson = await db.lesson.findFirst({ where: { id: lessonId, course: { userId } }, select: { id: true, courseId: true } });
  if (!lesson) throw new NotFoundError("Lesson not found");
  return lesson;
}

export type HighlightView = { id: string; exact: string; prefix: string; suffix: string; color: HighlightColor; note: string };
const highlightSelect = { id: true, exact: true, prefix: true, suffix: true, color: true, note: true } as const;

export async function getLessonNotes(userId: string, lessonId: string) {
  await ownedLesson(userId, lessonId);
  const [highlights, note] = await Promise.all([
    db.highlight.findMany({ where: { userId, lessonId }, orderBy: { createdAt: "asc" }, select: highlightSelect }),
    db.note.findUnique({ where: { userId_lessonId: { userId, lessonId } }, select: { body: true, updatedAt: true } }),
  ]);
  return { highlights: highlights as HighlightView[], note: note?.body ?? "" };
}

export async function createHighlight(userId: string, lessonId: string, input: { exact?: unknown; prefix?: unknown; suffix?: unknown; color?: unknown; note?: unknown }) {
  const lesson = await ownedLesson(userId, lessonId);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const exact = str(input.exact, MAX_HIGHLIGHT_CHARS + 1);
  if (!exact.trim()) throw new NotesError("Select some text to highlight.");
  if (exact.length > MAX_HIGHLIGHT_CHARS) throw new NotesError("That selection is too long to highlight. Try a shorter passage.");
  const count = await db.highlight.count({ where: { userId, lessonId } });
  if (count >= MAX_HIGHLIGHTS_PER_LESSON) throw new NotesError("This lesson has the maximum number of highlights.");
  const h = await db.highlight.create({
    data: {
      userId,
      lessonId,
      courseId: lesson.courseId,
      exact,
      prefix: str(input.prefix, CONTEXT_CHARS),
      suffix: str(input.suffix, CONTEXT_CHARS),
      color: isColor(input.color) ? input.color : "YELLOW",
      note: str(input.note, MAX_NOTE_CHARS),
    },
    select: highlightSelect,
  });
  return h as HighlightView;
}

export async function updateHighlight(userId: string, highlightId: string, patch: { color?: unknown; note?: unknown }) {
  const data: { color?: HighlightColor; note?: string } = {};
  if (patch.color !== undefined) {
    if (!isColor(patch.color)) throw new NotesError("Unknown colour.");
    data.color = patch.color;
  }
  if (patch.note !== undefined) {
    if (typeof patch.note !== "string") throw new NotesError("Invalid note.");
    if (patch.note.length > MAX_NOTE_CHARS) throw new NotesError("That note is too long.");
    data.note = patch.note;
  }
  const res = await db.highlight.updateMany({ where: { id: highlightId, userId }, data });
  if (res.count === 0) throw new NotFoundError("Highlight not found");
}

export async function deleteHighlight(userId: string, highlightId: string) {
  const res = await db.highlight.deleteMany({ where: { id: highlightId, userId } });
  if (res.count === 0) throw new NotFoundError("Highlight not found");
}

/** Save the lesson's note. An empty note deletes it. */
export async function saveLessonNote(userId: string, lessonId: string, body: unknown) {
  if (typeof body !== "string") throw new NotesError("Invalid note.");
  if (body.length > MAX_NOTE_CHARS) throw new NotesError(`Notes can be up to ${MAX_NOTE_CHARS.toLocaleString("en-US")} characters.`);
  const lesson = await ownedLesson(userId, lessonId);
  if (!body.trim()) {
    await db.note.deleteMany({ where: { userId, lessonId } });
    return;
  }
  await db.note.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, courseId: lesson.courseId, body },
    update: { body },
  });
}

/** All notes and highlights in a course, lesson by lesson in course order (for the Notes page and export). */
export async function getCourseNotes(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, title: true } });
  if (!course) throw new NotFoundError("Course not found");
  const lessons = await db.lesson.findMany({
    where: { courseId, OR: [{ highlights: { some: { userId } } }, { notes: { some: { userId } } }] },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      pageStart: true,
      pageEnd: true,
      unit: { select: { title: true } },
      notes: { where: { userId }, select: { body: true, updatedAt: true } },
      highlights: { where: { userId }, orderBy: { createdAt: "asc" }, select: highlightSelect },
    },
  });
  return {
    course,
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      unitTitle: l.unit.title,
      pageStart: l.pageStart,
      pageEnd: l.pageEnd,
      note: l.notes[0]?.body ?? null,
      highlights: l.highlights as HighlightView[],
    })),
  };
}
