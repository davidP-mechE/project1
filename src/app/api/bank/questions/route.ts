import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { listBank } from "@/server/bank";

/** Bank questions as JSON, with the same filters as /bank (owner and tutors only; 404 for everyone else). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return jsonError("Not found", 404);
  const sp = new URL(request.url).searchParams;
  try {
    const data = await listBank(session.user.id, {
      section: sp.get("section") ?? undefined,
      skillId: sp.get("skill") ?? undefined,
      week: Number(sp.get("week")) || undefined,
      difficulty: Number(sp.get("difficulty")) || undefined,
      type: sp.get("type") ?? undefined,
      status: sp.get("status") ?? undefined,
      q: sp.get("q") ?? undefined,
      page: Number(sp.get("page")) || 1,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
