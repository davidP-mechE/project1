import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { jsonError } from "@/server/http";
import { getSession } from "@/server/session";

/** One lesson's status, polled by the lesson page while it's being written. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/lessons/[lessonId]/status">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { courseId, lessonId } = await ctx.params;
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, courseId, course: { userId: session.user.id } },
    select: { status: true, error: true, flagReason: true, updatedAt: true },
  });
  if (!lesson) return jsonError("Not found", 404);
  return NextResponse.json(lesson, { headers: { "Cache-Control": "no-store" } });
}
