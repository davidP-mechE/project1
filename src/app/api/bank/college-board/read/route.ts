import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { isSameOrigin, jsonError } from "@/server/http";
import { BankError } from "@/server/bank";
import { NotFoundError } from "@/server/courses";
import { LimitError } from "@/server/limits";
import { MAX_CB_IMAGES, MAX_CB_PDF_BYTES, MAX_CB_TEXT, readCollegeBoardUpload } from "@/server/college-board";
import type { ReaderInput } from "@/server/ai/question-reader";

// Claude reads a few pages per request; that can take a couple of minutes.
export const maxDuration = 300;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * Read College Board questions from one upload: a PDF (the page sends big PDFs
 * a few pages at a time), up to 10 screenshots, or pasted text. Nothing is
 * saved: the answer is the transcribed questions, checked, for the author to review.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Not found", 404);
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_CB_PDF_BYTES + 200_000) return jsonError("That upload is too large. Upload fewer pages or screenshots at a time.", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Invalid upload.", 400);
  }
  let input: ReaderInput;
  const text = form.get("text");
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (typeof text === "string" && text.trim()) {
    if (text.length > MAX_CB_TEXT) return jsonError("That's too much text at once. Paste fewer questions.", 413);
    input = { kind: "text", text };
  } else if (files.length === 1 && files[0].type === "application/pdf") {
    if (files[0].size > MAX_CB_PDF_BYTES) return jsonError("That PDF is too large.", 413);
    input = { kind: "pdf", data: Buffer.from(await files[0].arrayBuffer()), name: files[0].name };
  } else if (files.length > 0 && files.every((f) => (IMAGE_TYPES as readonly string[]).includes(f.type))) {
    if (files.length > MAX_CB_IMAGES) return jsonError(`At most ${MAX_CB_IMAGES} screenshots at a time.`, 400);
    input = { kind: "images", images: await Promise.all(files.map(async (f) => ({ data: Buffer.from(await f.arrayBuffer()), mediaType: f.type as ImageType }))) };
  } else {
    return jsonError("Upload a PDF, screenshots (PNG or JPG), or paste the questions as text.", 400);
  }

  try {
    return NextResponse.json(await readCollegeBoardUpload(session.user.id, input));
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    if (err instanceof BankError) return jsonError(err.message, err.status);
    if (err instanceof LimitError) return jsonError(err.message, 429);
    console.error("[college-board] read failed:", err);
    return jsonError("Something went wrong reading that upload. Please try again.", 500);
  }
}
