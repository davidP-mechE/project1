/** Upload rules shared by the browser (instant feedback) and the server (enforcement). */

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_PAGES = 1000; // enforced when the PDF is parsed (Phase 2)
export const MAX_UPLOADS_PER_HOUR = 10;
export const MAX_TITLE_LENGTH = 200;

export type UploadRequest = { filename: string; size: number; contentType: string; rightsConfirmed: boolean };

export function validateUploadRequest(req: UploadRequest): { ok: true } | { ok: false; error: string } {
  if (!req.rightsConfirmed) {
    return { ok: false, error: "Please confirm you have the right to use this textbook." };
  }
  if (!/\.pdf$/i.test(req.filename.trim())) {
    return { ok: false, error: "Only PDF files (.pdf) can be uploaded." };
  }
  // Browsers sometimes report an empty type; the real check happens on the file's bytes.
  if (req.contentType && req.contentType !== "application/pdf" && req.contentType !== "application/octet-stream") {
    return { ok: false, error: "Only PDF files can be uploaded." };
  }
  if (!Number.isInteger(req.size) || req.size <= 0) {
    return { ok: false, error: "This file is empty." };
  }
  if (req.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `This file is ${formatBytes(req.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  }
  return { ok: true };
}

/** "Intro_to_Circuits-3rd_ed.pdf" -> "Intro to Circuits 3rd ed" */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/-+/g, " ").replace(/\s+/g, " ").trim();
  const title = base.length > 0 ? base : "Untitled textbook";
  return title.slice(0, MAX_TITLE_LENGTH);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
