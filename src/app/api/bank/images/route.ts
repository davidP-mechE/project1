import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { isSameOrigin, jsonError } from "@/server/http";
import { MAX_IMAGE_BYTES, saveBankImage } from "@/server/bank-images";

/** Upload an image for a bank question (owner and tutors). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Not found", 404);
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_IMAGE_BYTES + 64_000) return jsonError("Images can be at most 2 MB.", 413);
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("Invalid upload.", 400);
  }
  if (!(file instanceof File)) return jsonError("Choose an image.", 400);
  const out = await saveBankImage(session.user.id, Buffer.from(await file.arrayBuffer()));
  if ("error" in out) return jsonError(out.error, out.error === "Not found" ? 404 : 400);
  return NextResponse.json(out);
}
