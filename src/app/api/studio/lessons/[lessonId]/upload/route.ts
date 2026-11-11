import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { isSameOrigin, jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { StudioError, uploadToLesson } from "@/server/studio";

/** Owner only: upload one file into a lesson (PDF, image, Markdown or question-set JSON). Everyone else: 404. */
export async function POST(request: Request, ctx: RouteContext<"/api/studio/lessons/[lessonId]/upload">) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Not found", 404);
  const { lessonId } = await ctx.params;
  if (Number(request.headers.get("content-length") ?? 0) > 26 * 1024 * 1024) return jsonError("That file is too large (25 MB at most).", 413);
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("Invalid upload.", 400);
  }
  if (!(file instanceof File)) return jsonError("Choose a file.", 400);
  try {
    const result = await uploadToLesson(session.user.id, lessonId, file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    if (err instanceof StudioError) return jsonError(err.message, err.status);
    throw err;
  }
}

/** Anything but an owner's POST looks like a missing route. */
export function GET() {
  return jsonError("Not found", 404);
}
