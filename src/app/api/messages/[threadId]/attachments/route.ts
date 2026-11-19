import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { ClassError } from "@/server/access";
import { NotFoundError, RateLimitError } from "@/server/courses";
import { createAttachmentUpload } from "@/server/message-attachments";
import { isSameOrigin, jsonError } from "@/server/http";

const bodySchema = z.object({ filename: z.string().min(1).max(255), size: z.number().int(), contentType: z.string().max(100) });

/** Step 1 of attaching a file to a message: an upload URL (the browser sends the file straight to storage). */
export async function POST(request: Request, ctx: RouteContext<"/api/messages/[threadId]/attachments">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid upload request.", 400);
  const { threadId } = await ctx.params;
  try {
    return NextResponse.json(await createAttachmentUpload(session.user.id, threadId, parsed.data));
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Conversation not found.", 404);
    if (err instanceof RateLimitError) return jsonError(err.message, 429);
    if (err instanceof ClassError) return jsonError(err.message, err.status === 403 ? 403 : 400);
    throw err;
  }
}
