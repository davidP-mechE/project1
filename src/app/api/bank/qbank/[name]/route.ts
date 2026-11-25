import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { storage } from "@/server/storage";
import { canSeeQbankImage } from "@/server/bank-images";
import { qbankImageKey } from "@/server/qbank-import";

/**
 * A College Board Question Bank image. In-house content: only for the owner and people in classes
 * with in-house access (and never while ALLOW_COLLEGE_BOARD_CONTENT is off). Everyone else: 404.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/bank/qbank/[name]">) {
  const { name } = await ctx.params;
  const session = await getSession();
  if (!(await canSeeQbankImage(session?.user.id ?? null, name))) return jsonError("Not found", 404);
  const head = await storage.head(qbankImageKey(name));
  if (!head) return jsonError("Not found", 404);
  const body = await storage.getBuffer(qbankImageKey(name));
  return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
