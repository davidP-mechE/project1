import { catalogCoverKey } from "@/server/catalog";
import { jsonError } from "@/server/http";
import { getSession } from "@/server/session";
import { storage } from "@/server/storage";

/** Cover image of a provided course in the Hub (any logged-in student). */
export async function GET(_request: Request, ctx: RouteContext<"/api/hub/[entryId]/cover">) {
  if (!(await getSession())) return jsonError("Please log in.", 401);
  const { entryId } = await ctx.params;
  const key = entryId.length <= 64 ? await catalogCoverKey(entryId) : null;
  if (!key) return jsonError("Not found", 404);
  const bytes = await storage.getBuffer(key).catch(() => null);
  if (!bytes) return jsonError("Not found", 404);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
