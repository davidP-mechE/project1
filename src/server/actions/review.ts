"use server";

import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { ReviewError, reviewFlashcard, setTimeZone } from "../srs";
import type { ReviewRating } from "@/lib/srs/fsrs";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

export async function reviewCardAction(
  flashcardId: string,
  rating: number,
  durationMs: number,
): Promise<Result<{ due: string; state: string; intervals: Record<ReviewRating, string> }>> {
  const user = await requireUser();
  try {
    const res = await reviewFlashcard(user.id, id.parse(flashcardId), rating, { durationMs });
    return { ok: true, ...res };
  } catch (err) {
    if (err instanceof ReviewError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "This card no longer exists (its lesson may have been rewritten)." };
    console.error(err);
    return { ok: false, error: "Your answer couldn't be saved. Please try again." };
  }
}

/** Called once by the browser so "today" means the student's day. */
export async function setTimeZoneAction(timeZone: string): Promise<void> {
  const user = await requireUser();
  await setTimeZone(user.id, timeZone);
}
