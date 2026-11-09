import { notesToMarkdown } from "@/lib/export/notes-markdown";
import { NotFoundError } from "@/server/courses";
import { jsonError } from "@/server/http";
import { getCourseNotes } from "@/server/notes";
import { getSession } from "@/server/session";

/** Downloads the course's notes and highlights as a Markdown file. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/notes/export">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { courseId } = await ctx.params;
  try {
    const { course, lessons } = await getCourseNotes(session.user.id, courseId);
    const md = notesToMarkdown(course.title, lessons, new Date());
    const name = `${course.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "course"}-notes.md`;
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
