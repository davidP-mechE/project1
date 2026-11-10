import { NextResponse } from "next/server";
import { z } from "zod";
import { getGrader } from "@/server/ai/client";
import { NotFoundError } from "@/server/courses";
import { answerQuestion, ClassError } from "@/server/classes";
import { isSameOrigin, jsonError } from "@/server/http";
import { getSession } from "@/server/session";
import { limitOrResponse } from "@/server/rate-limit";
import { RATE_RULES } from "@/lib/usage/rate-limit";

const bodySchema = z.object({ itemId: z.string().min(1).max(64), choice: z.number().int().optional(), response: z.string().max(10_000).optional() });

/** Answer one question of an assigned question set. */
export async function POST(request: Request, ctx: RouteContext<"/api/assignments/[assignmentId]/answer">) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const limited = await limitOrResponse(RATE_RULES.answer, session.user.id);
  if (limited) return limited;
  const { assignmentId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || assignmentId.length > 64) return jsonError("Invalid request.", 400);
  try {
    const result = await answerQuestion(session.user.id, assignmentId, parsed.data.itemId, parsed.data, { grader: getGrader() });
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("This question isn't available. Reload the page.", 404);
    if (err instanceof ClassError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError("Something went wrong checking your answer. Please try again.", 500);
  }
}
