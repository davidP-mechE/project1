import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { NotFoundError } from "@/server/courses";
import { storage } from "@/server/storage";
import { fileForViewer } from "@/server/studio";

/**
 * A Course Studio file. Draft courses' files: the owner only (everyone else gets
 * the same 404 as a missing file). Published courses' files: signed-in users.
 * Never a public static URL.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/studio/files/[fileId]">) {
  const { fileId } = await ctx.params;
  const session = await getSession();
  if (!session || fileId.length > 64) return jsonError("Not found", 404);
  try {
    const f = await fileForViewer(session.user.id, fileId);
    const body = await storage.getBuffer(f.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": `inline; filename="${f.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    throw err;
  }
}
