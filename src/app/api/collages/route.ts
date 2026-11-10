import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { RateLimitError } from "@/server/courses";
import { CollageError, createCollage } from "@/server/collage";
import { isSameOrigin, jsonError } from "@/server/http";

const fileSchema = z.object({ filename: z.string().min(1).max(255), size: z.number().int(), contentType: z.string().max(100) });
const bodySchema = z.object({ title: z.string().max(200), files: z.array(fileSchema).min(1).max(50), rightsConfirmed: z.boolean() });

/** Step 1 of a slide collage (one course from several decks): the course, and an upload URL per deck. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid upload request.", 400);
  try {
    return NextResponse.json(await createCollage(session.user.id, parsed.data));
  } catch (err) {
    if (err instanceof RateLimitError) return jsonError(err.message, 429);
    if (err instanceof CollageError) return jsonError(err.message, 400);
    throw err;
  }
}
