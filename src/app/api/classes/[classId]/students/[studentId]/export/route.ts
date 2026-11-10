import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { exportStudentForStaff } from "@/server/student-data";

/** One student's records in this program, for a teacher or the program admin (audited). */
export async function GET(_request: Request, ctx: RouteContext<"/api/classes/[classId]/students/[studentId]/export">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { classId, studentId } = await ctx.params;
  try {
    const data = await exportStudentForStaff(session.user.id, classId, studentId);
    return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="student-records.json"', "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    if (err instanceof ClassError) return jsonError(err.message, err.status);
    throw err;
  }
}
