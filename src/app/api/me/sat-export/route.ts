import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { studentRecords } from "@/server/student-data";

/** A student's own tutoring records (scores, answers, attendance, mistake log…) as a JSON file. */
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const data = await studentRecords(session.user.id);
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="my-tutoring-records.json"', "Cache-Control": "private, no-store" } });
}
