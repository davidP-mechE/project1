import { NextResponse } from "next/server";
import { AccessDeniedError } from "@/server/program-access";
import { z } from "zod";
import { getSession } from "@/server/session";
import { createUpload, RateLimitError } from "@/server/courses";
import { isSameOrigin, jsonError } from "@/server/http";
import { validateUploadRequest } from "@/lib/upload/limits";

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int(),
  contentType: z.string().max(100),
  rightsConfirmed: z.boolean(),
  kind: z.enum(["book", "slides"]).default("book"),
});

/** Step 1 of an upload: check the request and hand back a URL to upload the file to. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Bad origin", 403);
  const session = await getSession();
  if (!session) return jsonError("Please log in again.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid upload request.", 400);

  const check = validateUploadRequest(parsed.data);
  if (!check.ok) return jsonError(check.error, 400);

  try {
    const result = await createUpload(session.user.id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) return jsonError(err.message, 429);
    if (err instanceof AccessDeniedError) return jsonError(err.message, 403);
    throw err;
  }
}
