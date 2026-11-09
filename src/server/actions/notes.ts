"use server";

import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { createHighlight, deleteHighlight, NotesError, saveLessonNote, updateHighlight, type HighlightView } from "../notes";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof NotesError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists. Reload the page." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function createHighlightAction(
  lessonId: string,
  input: { exact: string; prefix: string; suffix: string; color: string; note?: string },
): Promise<Result<{ highlight: HighlightView }>> {
  const user = await requireUser();
  try {
    return { ok: true, highlight: await createHighlight(user.id, id.parse(lessonId), input ?? {}) };
  } catch (err) {
    return fail(err);
  }
}

export async function updateHighlightAction(highlightId: string, patch: { color?: string; note?: string }): Promise<Result> {
  const user = await requireUser();
  try {
    await updateHighlight(user.id, id.parse(highlightId), patch ?? {});
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteHighlightAction(highlightId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await deleteHighlight(user.id, id.parse(highlightId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveLessonNoteAction(lessonId: string, body: string): Promise<Result> {
  const user = await requireUser();
  try {
    await saveLessonNote(user.id, id.parse(lessonId), body);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
