import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { storage } from "@/server/storage";
import { canSeeBankImage, imageKey, imageType, NAME } from "@/server/bank-images";

/** A bank question's image: authors see all; students only images on published questions. */
export async function GET(_request: Request, ctx: RouteContext<"/api/bank/images/[name]">) {
  const { name } = await ctx.params;
  const session = await getSession();
  if (!session || !NAME.test(name) || !(await canSeeBankImage(session.user.id, name))) return jsonError("Not found", 404);
  const head = await storage.head(imageKey(name));
  if (!head) return jsonError("Not found", 404);
  const body = await storage.getBuffer(imageKey(name));
  return new Response(new Uint8Array(body), { headers: { "Content-Type": imageType(name), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
