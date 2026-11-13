import { NextResponse } from "next/server";
import { isNoAi, NO_AI_MESSAGE } from "@/server/program-access";
import { z } from "zod";
import { getWriter } from "@/server/ai/client";
import { claudeEnabled } from "@/server/env";
import { NotFoundError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";
import { limitOrResponse } from "@/server/rate-limit";
import { generateSkillQuestions, ReviewError } from "@/server/review";
import { getSession } from "@/server/session";
import { RATE_RULES } from "@/lib/usage/rate-limit";

// Writing 5 questions takes Claude a little while.
export const maxDuration = 120;

const body = z.object({ courseId: z.string().min(1).max(64), skill: z.string().min(1).max(200) });

/** Review: more questions on one skill. Body: { courseId, skill } (skill = the skill's key). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  if (!claudeEnabled) return jsonError("Writing new questions needs an ANTHROPIC_API_KEY on the server.", 503);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  if (await isNoAi(session.user.id)) return jsonError(NO_AI_MESSAGE, 403);
  const limited = await limitOrResponse(RATE_RULES.skillQuestions, session.user.id);
  if (limited) return limited;
  try {
    const items = await generateSkillQuestions(session.user.id, parsed.data.courseId, parsed.data.skill, { writer: getWriter() });
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("That skill no longer exists.", 404);
    if (err instanceof ReviewError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError("Something went wrong writing new questions. Please try again.", 500);
  }
}
