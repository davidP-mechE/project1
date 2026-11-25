import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { completeImportUpload } from "@/server/academic-index";
import { NotFoundError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";

/** Step 3: the PDF is in storage; check it and queue it to be read. */
export async function POST(request: Request, ctx: RouteContext<"/api/academic-index/uploads/[uploadId]/complete">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const { uploadId } = await ctx.params;
  try {
    const result = await completeImportUpload(session.user.id, uploadId);
    if (!result.ok) return jsonError(result.error, 422);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Upload not found.", 404);
    throw err;
  }
}
