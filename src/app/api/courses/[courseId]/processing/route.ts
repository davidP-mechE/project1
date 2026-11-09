import { NextResponse } from "next/server";
import { getProcessingStatus, NotFoundError } from "@/server/courses";
import { jsonError } from "@/server/http";
import { getSession } from "@/server/session";

/** Live processing status, polled by the course page while a book is being read. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/processing">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { courseId } = await ctx.params;
  try {
    const status = await getProcessingStatus(session.user.id, courseId);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
