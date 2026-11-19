import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { staffLiveView, studentLiveView } from "@/server/live";

/**
 * A live run's state, polled every few seconds: the staff screen (counts,
 * answers) for staff with access to the class, otherwise the student screen
 * (no answers until revealed). Anyone else gets "not found".
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/live/[runId]">) {
  const { runId } = await ctx.params;
  const session = await getSession();
  if (!session || runId.length > 64) return jsonError("Not found", 404);
  const headers = { "Cache-Control": "no-store" };
  try {
    const v = await staffLiveView(session.user.id, runId);
    const { access, ...rest } = v;
    void access;
    return NextResponse.json({ mode: "staff", ...rest }, { headers });
  } catch (err) {
    if (!(err instanceof NotFoundError || err instanceof ClassError)) throw err;
  }
  try {
    return NextResponse.json({ mode: "student", ...(await studentLiveView(session.user.id, runId)) }, { headers });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
