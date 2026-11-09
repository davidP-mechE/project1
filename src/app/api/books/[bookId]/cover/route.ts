import { db } from "@/server/db";
import { jsonError } from "@/server/http";
import { getSession } from "@/server/session";
import { storage } from "@/server/storage";

/** The cover thumbnail (small JPEG), only for the book's owner. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[bookId]/cover">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { bookId } = await ctx.params;
  const book = await db.book.findFirst({ where: { id: bookId, userId: session.user.id }, select: { coverKey: true } });
  if (!book?.coverKey) return jsonError("Not found", 404);
  const bytes = await storage.getBuffer(book.coverKey).catch(() => null);
  if (!bytes) return jsonError("Not found", 404);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
