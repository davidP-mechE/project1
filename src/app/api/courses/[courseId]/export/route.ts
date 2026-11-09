import { buildApkg } from "@/lib/export/anki";
import { courseToMarkdown } from "@/lib/export/course-markdown";
import { flashcardsCsv, questionsCsv } from "@/lib/export/csv";
import { NotFoundError } from "@/server/courses";
import { getCourseExport, sqlJs } from "@/server/export";
import { jsonError } from "@/server/http";
import { getSession } from "@/server/session";
import { track } from "@/server/analytics";
import { limitOrResponse } from "@/server/rate-limit";
import { RATE_RULES } from "@/lib/usage/rate-limit";

/**
 * Downloads: ?format=md | cards.csv | questions.csv | apkg
 * (md also takes &answers=0 to leave answers out, &flashcards=0 to leave cards out).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/courses/[courseId]/export">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const limited = await limitOrResponse(RATE_RULES.export, session.user.id);
  if (limited) return limited;
  const { courseId } = await ctx.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "md";
  let course;
  try {
    course = await getCourseExport(session.user.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
  const base = course.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "course";
  const file = (body: BodyInit, name: string, type: string) =>
    new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  const now = new Date();
  if (["md", "cards.csv", "questions.csv", "apkg"].includes(format)) await track("export_downloaded", session.user.id, { format });
  switch (format) {
    case "md":
      return file(courseToMarkdown(course, { answers: url.searchParams.get("answers") !== "0", flashcards: url.searchParams.get("flashcards") !== "0" }, now), `${base}-study-guide.md`, "text/markdown; charset=utf-8");
    case "cards.csv":
      return file(flashcardsCsv(course), `${base}-flashcards.csv`, "text/csv; charset=utf-8");
    case "questions.csv":
      return file(questionsCsv(course), `${base}-questions.csv`, "text/csv; charset=utf-8");
    case "apkg": {
      const bytes = buildApkg(await sqlJs(), course, now);
      return file(new Blob([new Uint8Array(bytes)]), `${base}.apkg`, "application/octet-stream");
    }
    default:
      return jsonError("Unknown format.", 400);
  }
}
