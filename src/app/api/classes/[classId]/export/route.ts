import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { exportGrades } from "@/server/roster";

/** Grades for a class as CSV (students in the caller's scope; emails only if asked for and allowed). */
export async function GET(request: Request, ctx: RouteContext<"/api/classes/[classId]/export">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { classId } = await ctx.params;
  try {
    const { filename, csv } = await exportGrades(session.user.id, classId, { contacts: new URL(request.url).searchParams.get("contacts") === "1" });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    if (err instanceof ClassError) return jsonError(err.message, err.status);
    throw err;
  }
}
