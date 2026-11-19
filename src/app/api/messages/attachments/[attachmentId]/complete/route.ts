import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { completeAttachmentUpload } from "@/server/message-attachments";
import { isSameOrigin, jsonError } from "@/server/http";

/** Step 2: the file is in storage; check its size and real type (by its first bytes). */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/attachments/[attachmentId]/complete">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const { attachmentId } = await ctx.params;
  try {
    const r = await completeAttachmentUpload(session.user.id, attachmentId);
    if (!r.ok) return jsonError(r.error, 422);
    return NextResponse.json(r.attachment);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("File not found.", 404);
    throw err;
  }
}
