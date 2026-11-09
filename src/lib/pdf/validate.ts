/**
 * Quick checks that a file is really a PDF, using only its first and last
 * bytes (so we never have to load a 200 MB file into memory to reject it).
 * Full parsing happens later in the processing job (Phase 2).
 */

export const PDF_HEAD_BYTES = 1024;
export const PDF_TAIL_BYTES = 2048;

export type PdfCheck = { ok: true; version: string } | { ok: false; reason: string };

export function checkPdfSignature(head: Uint8Array, tail: Uint8Array): PdfCheck {
  // The PDF spec allows the "%PDF-" header anywhere in the first 1024 bytes.
  const headText = Buffer.from(head.subarray(0, PDF_HEAD_BYTES)).toString("latin1");
  const match = /%PDF-(\d\.\d)/.exec(headText);
  if (!match) {
    return { ok: false, reason: "This file isn't a PDF (it's missing the PDF header). Please upload a .pdf file." };
  }
  // Every complete PDF ends with an end-of-file marker. If it's missing, the
  // upload was probably cut off or the file is damaged.
  const tailText = Buffer.from(tail).toString("latin1");
  if (!tailText.includes("%%EOF")) {
    return {
      ok: false,
      reason: "This PDF looks incomplete or damaged (no end-of-file marker). Try downloading it again and re-uploading.",
    };
  }
  if (/\/Encrypt\b/.test(tailText)) {
    // The trailer is usually at the end; an /Encrypt entry means a password-protected PDF.
    return {
      ok: false,
      reason: "This PDF is password-protected or encrypted. Please upload an unlocked copy.",
    };
  }
  return { ok: true, version: match[1] };
}
