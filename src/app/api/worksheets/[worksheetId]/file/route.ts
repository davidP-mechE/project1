import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { storage } from "@/server/storage";
import { jsonError } from "@/server/http";

/** The original worksheet PDF, for its owner only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/worksheets/[worksheetId]/file">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { worksheetId } = await ctx.params;
  const ws = await db.worksheet.findFirst({ where: { id: worksheetId, ownerId: session.user.id }, select: { fileKey: true } });
  if (!ws) return jsonError("Not found", 404);
  const file = await storage.getBuffer(ws.fileKey).catch(() => null);
  if (!file) return jsonError("Not found", 404);
  return new Response(new Uint8Array(file), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": "inline" } });
}
