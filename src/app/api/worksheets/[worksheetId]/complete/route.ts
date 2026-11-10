import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { completeWorksheetUpload } from "@/server/worksheets";
import { isSameOrigin, jsonError } from "@/server/http";

/** Step 3: the PDF is uploaded; check it and have Claude read it. */
export async function POST(request: Request, ctx: RouteContext<"/api/worksheets/[worksheetId]/complete">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const { worksheetId } = await ctx.params;
  try {
    const result = await completeWorksheetUpload(session.user.id, worksheetId);
    if (!result.ok) return jsonError(result.error, 422);
    return NextResponse.json({ worksheetId });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Worksheet not found.", 404);
    throw err;
  }
}
