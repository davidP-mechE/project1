import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { redoCsv } from "@/server/insights";

/** The signed-in student's redo list as CSV (same filters as the page). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const sp = new URL(request.url).searchParams;
  const csv = await redoCsv(session.user.id, { skillId: sp.get("skill")?.slice(0, 120) || undefined, errorTypeId: sp.get("error")?.slice(0, 40) || undefined, status: sp.get("status") ?? undefined });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="redo-list.csv"', "Cache-Control": "no-store" } });
}
