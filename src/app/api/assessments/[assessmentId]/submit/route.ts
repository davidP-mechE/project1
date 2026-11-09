import { NextResponse } from "next/server";
import { getGrader } from "@/server/ai/client";
import { submitTest } from "@/server/assessments";
import { NotFoundError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";
import { getSession } from "@/server/session";
import { limitOrResponse } from "@/server/rate-limit";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { StudyError } from "@/server/study";

// Grading a test with written answers can take a little while.
export const maxDuration = 120;

/** Submit a unit test / final exam: { answers: { [questionId]: { choice } | { response } } }. */
export async function POST(request: Request, ctx: RouteContext<"/api/assessments/[assessmentId]/submit">) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const limited = await limitOrResponse(RATE_RULES.testSubmit, session.user.id);
  if (limited) return limited;
  const { assessmentId } = await ctx.params;
  if (assessmentId.length > 64) return jsonError("Not found", 404);
  let body: { answers?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }
  const answers = body.answers && typeof body.answers === "object" ? (body.answers as Record<string, { choice?: unknown; response?: unknown }>) : {};
  try {
    return NextResponse.json(await submitTest(session.user.id, assessmentId, answers, { grader: getGrader() }));
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("This test no longer exists.", 404);
    if (err instanceof StudyError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError("Something went wrong grading your test. Your answers are kept; please submit again.", 500);
  }
}
