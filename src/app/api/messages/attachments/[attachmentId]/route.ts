import { getSession } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { discardAttachment, readAttachment } from "@/server/message-attachments";
import { isSameOrigin, jsonError } from "@/server/http";

/**
 * A file from a conversation, for the people who can read it (its two
 * participants and the program admin). Shown inline; ?download=1 saves it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/messages/attachments/[attachmentId]">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { attachmentId } = await ctx.params;
  try {
    const f = await readAttachment(session.user.id, attachmentId);
    const download = new URL(request.url).searchParams.has("download");
    const ascii = f.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(f.body), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Length": String(f.body.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}

/** Remove a file you attached but haven't sent. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/messages/attachments/[attachmentId]">) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const { attachmentId } = await ctx.params;
  try {
    await discardAttachment(session.user.id, attachmentId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
