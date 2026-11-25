import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { AcademicIndexError, createImportUpload } from "@/server/academic-index";
import { isSameOrigin, jsonError } from "@/server/http";

const bodySchema = z.object({ fileType: z.string().max(20), size: z.number().int(), contentType: z.string().max(100) });

/** Step 1 of an Academic Index PDF upload: an upload URL for the file (straight to storage). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid upload request.", 400);
  try {
    return NextResponse.json(await createImportUpload(session.user.id, parsed.data));
  } catch (err) {
    if (err instanceof AcademicIndexError) return jsonError(err.message, err.status);
    throw err;
  }
}
