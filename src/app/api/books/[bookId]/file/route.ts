import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { storage } from "@/server/storage";
import { jsonError } from "@/server/http";

/** Opens the original PDF: checks ownership, then redirects to a 10-minute signed link. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[bookId]/file">) {
  const session = await getSession();
  if (!session) return jsonError("Please log in.", 401);
  const { bookId } = await ctx.params;
  const book = await db.book.findFirst({
    where: { id: bookId, userId: session.user.id, status: { in: ["UPLOADED", "PROCESSING", "READY"] } },
    select: { storageKey: true },
  });
  if (!book) return jsonError("Not found", 404);
  redirect(await storage.createDownloadUrl(book.storageKey, { expiresInSeconds: 600, contentType: "application/pdf" }));
}
