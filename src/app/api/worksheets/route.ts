import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/session";
import { createWorksheetUpload, WorksheetError } from "@/server/worksheets";
import { isSameOrigin, jsonError } from "@/server/http";

const bodySchema = z.object({ filename: z.string().min(1).max(255), size: z.number().int(), contentType: z.string().max(100), rightsConfirmed: z.boolean() });

/** Step 1 of a worksheet upload: an upload URL for the PDF. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid upload request.", 400);
  try {
    return NextResponse.json(await createWorksheetUpload(session.user.id, parsed.data));
  } catch (err) {
    if (err instanceof WorksheetError) return jsonError(err.message, 400);
    throw err;
  }
}
