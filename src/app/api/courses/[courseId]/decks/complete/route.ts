import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { CollageError, completeDecks } from "@/server/collage";
import { isSameOrigin, jsonError } from "@/server/http";

/** Step 3: the decks are uploaded; check them and start merging them into the course. */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/decks/complete">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const { courseId } = await ctx.params;
  try {
    const result = await completeDecks(session.user.id, courseId);
    if (!result.ok) return jsonError(result.error, 422);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Course not found.", 404);
    if (err instanceof CollageError) return jsonError(err.message, 400);
    throw err;
  }
}
