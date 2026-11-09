import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { completeUpload, NotFoundError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";

/** Step 3 of an upload: the browser says it's done; we verify the stored file. */
export async function POST(request: Request, ctx: RouteContext<"/api/uploads/[bookId]/complete">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const { bookId } = await ctx.params;
  try {
    const result = await completeUpload(session.user.id, bookId);
    if (!result.ok) return jsonError(result.error, 422);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Upload not found.", 404);
    throw err;
  }
}
