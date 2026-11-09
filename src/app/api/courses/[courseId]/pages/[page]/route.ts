import { NextResponse } from "next/server";
import { NotFoundError } from "@/server/courses";
import { jsonError } from "@/server/http";
import { getPagePreview } from "@/server/outline";
import { getSession } from "@/server/session";

/** Start/end text of one page, used by the outline editor to check lesson boundaries. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/pages/[page]">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { courseId, page } = await ctx.params;
  try {
    const preview = await getPagePreview(session.user.id, courseId, Number(page));
    return NextResponse.json(preview, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
