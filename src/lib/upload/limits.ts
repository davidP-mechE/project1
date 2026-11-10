/** Upload rules shared by the browser (instant feedback) and the server (enforcement). */

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_PAGES = 1000; // enforced when the PDF is parsed (Phase 2)
export const MAX_UPLOADS_PER_HOUR = 10;
export const MAX_TITLE_LENGTH = 200;

export const MAX_SLIDES = 300;
export const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** "book": a textbook PDF. "slides": lecture slides, as a PDF or a PowerPoint (.pptx) file. */
export type UploadKind = "book" | "slides";

export type UploadRequest = { filename: string; size: number; contentType: string; rightsConfirmed: boolean; kind?: UploadKind };

export const isPptx = (filename: string) => /\.pptx$/i.test(filename.trim());

export function validateUploadRequest(req: UploadRequest): { ok: true } | { ok: false; error: string } {
  const slides = req.kind === "slides";
  if (!req.rightsConfirmed) {
    return { ok: false, error: slides ? "Please confirm you have the right to use these slides." : "Please confirm you have the right to use this textbook." };
  }
  const pdf = /\.pdf$/i.test(req.filename.trim());
  if (slides ? !pdf && !isPptx(req.filename) : !pdf) {
    return {
      ok: false,
      error: slides
        ? "Upload slides as a PDF (.pdf) or PowerPoint (.pptx) file. From Google Slides or Keynote, use File → Download → PDF."
        : /\.(pptx?|key)$/i.test(req.filename)
          ? "That looks like a slide deck. Upload it under Slides instead."
          : "Only PDF files (.pdf) can be uploaded.",
    };
  }
  // Browsers sometimes report an empty type; the real check happens on the file's bytes.
  const allowed = ["application/pdf", "application/octet-stream", ...(slides ? [PPTX_TYPE, "application/zip"] : [])];
  if (req.contentType && !allowed.includes(req.contentType)) {
    return { ok: false, error: slides ? "Only PDF or PowerPoint (.pptx) files can be uploaded." : "Only PDF files can be uploaded." };
  }
  if (!Number.isInteger(req.size) || req.size <= 0) {
    return { ok: false, error: "This file is empty." };
  }
  if (req.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `This file is ${formatBytes(req.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  }
  return { ok: true };
}

/** Slide collages: several decks under one course. */
export const MAX_DECKS_PER_COURSE = 30;
export const MAX_DECKS_PER_UPLOAD = 15;

export type DeckFile = { filename: string; size: number; contentType: string };

/** Check a batch of decks for a collage (new or added to an existing course). */
export function validateDeckFiles(files: DeckFile[], rightsConfirmed: boolean, existingDecks = 0): { ok: true } | { ok: false; error: string } {
  if (files.length === 0) return { ok: false, error: "Choose at least one slide deck." };
  if (files.length > MAX_DECKS_PER_UPLOAD) return { ok: false, error: `You can add up to ${MAX_DECKS_PER_UPLOAD} decks at a time.` };
  if (existingDecks + files.length > MAX_DECKS_PER_COURSE) {
    return { ok: false, error: `A course can have up to ${MAX_DECKS_PER_COURSE} decks${existingDecks ? ` (this one has ${existingDecks})` : ""}.` };
  }
  for (const f of files) {
    const check = validateUploadRequest({ ...f, rightsConfirmed, kind: "slides" });
    if (!check.ok) return { ok: false, error: files.length > 1 ? `${f.filename}: ${check.error}` : check.error };
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_UPLOAD_BYTES * 2) return { ok: false, error: `These decks add up to ${formatBytes(total)}. Add up to ${formatBytes(MAX_UPLOAD_BYTES * 2)} at a time.` };
  return { ok: true };
}

/** "Intro_to_Circuits-3rd_ed.pdf" -> "Intro to Circuits 3rd ed" */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.(pdf|pptx)$/i, "").replace(/[_]+/g, " ").replace(/-+/g, " ").replace(/\s+/g, " ").trim();
  const title = base.length > 0 ? base : "Untitled textbook";
  return title.slice(0, MAX_TITLE_LENGTH);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
