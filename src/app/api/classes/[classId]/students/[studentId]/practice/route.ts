import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { studentPractice } from "@/server/tutor-view";

/** A student's practice-test insights, logs and redo progress, for staff whose class (and scope) includes them. Everyone else: 404. */
export async function GET(_request: Request, ctx: RouteContext<"/api/classes/[classId]/students/[studentId]/practice">) {
  const session = await getSession();
  if (!session) return jsonError("Not found", 404);
  const { classId, studentId } = await ctx.params;
  if (classId.length > 64 || studentId.length > 64) return jsonError("Not found", 404);
  try {
    const p = await studentPractice(session.user.id, classId, studentId);
    return NextResponse.json({ student: p.student, insights: p.insights, redo: p.redo, logs: p.logs }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    if (err instanceof ClassError) return jsonError(err.message, err.status);
    throw err;
  }
}
