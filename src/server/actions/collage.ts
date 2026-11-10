"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { CollageError, removeFailedDeck, retryDecks } from "../collage";

type Result = { ok: true } | { ok: false; error: string };
const id = z.string().min(1).max(64);

function fail(err: unknown): Result {
  if (err instanceof CollageError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That course or deck no longer exists." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Try adding decks that couldn't be merged again. */
export async function retryDecksAction(courseId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await retryDecks(user.id, id.parse(courseId));
    revalidatePath(`/courses/${courseId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Remove a deck that couldn't be added. */
export async function removeDeckAction(courseId: string, deckId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await removeFailedDeck(user.id, id.parse(courseId), id.parse(deckId));
    revalidatePath(`/courses/${courseId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
