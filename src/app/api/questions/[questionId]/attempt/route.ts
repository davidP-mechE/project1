import { NextResponse } from "next/server";
import { getGrader } from "@/server/ai/client";
import { NotFoundError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";
import { getSession } from "@/server/session";
import { limitOrResponse } from "@/server/rate-limit";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { StudyError, submitAttempt } from "@/server/study";

/**
 * Check an answer to a practice question.
 * Body: { choice: number } for multiple choice, { response: string } otherwise.
 * A route handler (not a Server Action) so several answers can be checked at once.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/questions/[questionId]/attempt">) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const limited = await limitOrResponse(RATE_RULES.answer, session.user.id);
  if (limited) return limited;
  const { questionId } = await ctx.params;
  if (questionId.length > 64) return jsonError("Not found", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }
  const input = (body && typeof body === "object" ? body : {}) as { choice?: unknown; response?: unknown };
  try {
    const attempt = await submitAttempt(session.user.id, questionId, { choice: input.choice, response: input.response }, { grader: getGrader() });
    return NextResponse.json({ attempt });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("This question no longer exists. Reload the page.", 404);
    if (err instanceof StudyError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError("Something went wrong checking your answer. Please try again.", 500);
  }
}
