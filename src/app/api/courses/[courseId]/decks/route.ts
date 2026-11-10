import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { NotFoundError, RateLimitError } from "@/server/courses";
import { addDecks, CollageError } from "@/server/collage";
import { isSameOrigin, jsonError } from "@/server/http";

const fileSchema = z.object({ filename: z.string().min(1).max(255), size: z.number().int(), contentType: z.string().max(100) });
const bodySchema = z.object({ files: z.array(fileSchema).min(1).max(50), rightsConfirmed: z.boolean() });

/** Step 1 of adding decks to a slides course: an upload URL per deck. */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/decks">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid upload request.", 400);
  const { courseId } = await ctx.params;
  try {
    return NextResponse.json(await addDecks(session.user.id, courseId, parsed.data));
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Course not found.", 404);
    if (err instanceof RateLimitError) return jsonError(err.message, 429);
    if (err instanceof CollageError) return jsonError(err.message, 400);
    throw err;
  }
}
