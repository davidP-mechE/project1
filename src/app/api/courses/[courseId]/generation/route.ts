import { NextResponse } from "next/server";
import { NotFoundError } from "@/server/courses";
import { getGenerationProgress } from "@/server/generation/lessons";
import { jsonError } from "@/server/http";
import { getSession } from "@/server/session";

/** "Lesson 14 of 52": polled by the course page while lessons are being written. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/generation">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { courseId } = await ctx.params;
  try {
    return NextResponse.json(await getGenerationProgress(session.user.id, courseId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
