import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { listPublicCourses } from "@/server/studio";

/** Published courses only (never drafts, even for the owner: the owner's list is in the Studio). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 100) ?? undefined;
  return NextResponse.json({ courses: await listPublicCourses(q) });
}
