import { db } from "./db";
import { storage } from "./storage";
import { ensureAiBudget } from "./limits";
import { recordUsage } from "./usage";
import { AiError } from "./ai/writer";
import type { ApplicationReader } from "./ai/academic-index";
import { PdfOpenError, PdfReader } from "./processing/pdf-reader";
import { cleanOcrText } from "./processing/ocr";
import { deleteUploadFile } from "./academic-index";
import { MAX_IMPORT_PAGES, type FileType } from "@/lib/academic-index/extraction";

/**
 * Reading an Academic Index PDF, in the worker only (pdf.js and OCR use native
 * modules the web app doesn't load). Text is pulled from each page; a page
 * with no text layer (a scan or photo) is rendered and OCR'd. The text then
 * goes to Claude, which fills the fixed extraction schema. The fields wait on
 * the upload row until the student reviews them.
 */

/** Pages with less text than this are treated as scans. */
const MIN_TEXT_CHARS = 20;
const OCR_WIDTH = 1700;

export type Ocr = { recognize(png: Buffer): Promise<{ text: string; confidence: number }> };

async function fail(uploadId: string, error: string) {
  // A file that couldn't be read isn't kept either.
  await deleteUploadFile(uploadId, "FAILED", error);
  return "failed" as const;
}

export async function runAcademicExtractJob(payload: { uploadId: string }, deps: { reader: ApplicationReader; ocr: Ocr }): Promise<"extracted" | "failed" | "gone"> {
  const u = await db.academicIndexUpload.findUnique({ where: { id: payload.uploadId } });
  if (!u || !u.storageKey || u.status !== "UPLOADED") return "gone";

  let reader: PdfReader;
  try {
    reader = await PdfReader.open(new Uint8Array(await storage.getBuffer(u.storageKey)));
  } catch (err) {
    if (err instanceof PdfOpenError) return fail(u.id, err.message);
    throw err;
  }
  const pages: { page: number; text: string }[] = [];
  try {
    const count = reader.pageCount;
    if (count === 0) return fail(u.id, "This PDF has no pages.");
    if (count > MAX_IMPORT_PAGES) return fail(u.id, `This PDF has ${count} pages; up to ${MAX_IMPORT_PAGES} can be read. Upload only the pages you need.`);
    for (let n = 1; n <= count; n++) {
      let text = (await reader.readPage(n)).text.trim();
      if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
        const canvas = await reader.render(n, { width: OCR_WIDTH });
        const ocr = await deps.ocr.recognize(canvas.toBuffer("image/png"));
        text = cleanOcrText(ocr.text);
      }
      pages.push({ page: n, text });
    }
  } finally {
    await reader.close().catch(() => {});
  }
  await db.academicIndexUpload.update({ where: { id: u.id }, data: { pageCount: pages.length } });
  if (pages.every((p) => !p.text.trim())) return fail(u.id, "No text could be read from this PDF. Enter the details by hand instead.");

  await ensureAiBudget(u.userId);
  const usage = { userId: u.userId, feature: "ACADEMIC_INDEX_IMPORT" as const };
  let result;
  try {
    result = await deps.reader.read({ fileType: u.fileType as FileType, pages });
  } catch (err) {
    if (err instanceof AiError) {
      await recordUsage(usage, err.calls);
      if (err.kind !== "retryable") return fail(u.id, err.userMessage);
    }
    throw err;
  }
  await recordUsage(usage, result.calls);
  await db.academicIndexUpload.update({ where: { id: u.id }, data: { status: "EXTRACTED", extracted: result.value, error: result.value.problem.trim().slice(0, 300) || null } });
  return "extracted";
}

export async function markAcademicExtractFailed(uploadId: string, message: string) {
  await fail(uploadId, message);
}
