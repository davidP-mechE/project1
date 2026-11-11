import { db } from "./db";
import { storage } from "./storage";
import { ensureAiBudget } from "./limits";
import { recordUsage } from "./usage";
import { AiError, type LessonWriter } from "./ai/writer";
import { PdfOpenError, PdfReader } from "./processing/pdf-reader";
import { markWorksheetFailed } from "./worksheets";
import { MAX_WORKSHEET_PAGES, normalizeWorksheet, type WorksheetPage } from "@/lib/ai/worksheet";

/**
 * Reading a worksheet, in the worker only (it renders pages with a native
 * module the web app doesn't load). See src/server/worksheets.ts.
 */

const PAGE_IMAGE_WIDTH = 1100; // readable equations without huge images

/** In the worker: show Claude the pages and save the questions it lists. */
export async function runWorksheetJob(payload: { worksheetId: string }, deps: { writer: LessonWriter }): Promise<"read" | "failed" | "gone"> {
  const ws = await db.worksheet.findUnique({ where: { id: payload.worksheetId } });
  if (!ws) return "gone";
  let reader: PdfReader;
  try {
    reader = await PdfReader.open(new Uint8Array(await storage.getBuffer(ws.fileKey)));
  } catch (err) {
    if (err instanceof PdfOpenError) return markWorksheetFailed(ws.id, err.message);
    throw err;
  }
  const pages: WorksheetPage[] = [];
  try {
    const count = reader.pageCount;
    if (count === 0) return markWorksheetFailed(ws.id, "This PDF has no pages.");
    if (count > MAX_WORKSHEET_PAGES) {
      return markWorksheetFailed(ws.id, `This PDF has ${count} pages. Worksheets can have up to ${MAX_WORKSHEET_PAGES}: split it into smaller files.`);
    }
    for (let n = 1; n <= count; n++) {
      const page = await reader.readPage(n);
      const canvas = await reader.render(n, { width: PAGE_IMAGE_WIDTH });
      pages.push({ pageNumber: n, text: page.text, png: canvas.toBuffer("image/png") });
    }
    await db.worksheet.update({ where: { id: ws.id }, data: { pageCount: count } });
  } finally {
    await reader.close().catch(() => {});
  }

  await ensureAiBudget(ws.ownerId);
  const usage = { userId: ws.ownerId, feature: "WORKSHEET" as const };
  let result;
  try {
    result = await deps.writer.readWorksheet(ws.title, pages);
  } catch (err) {
    if (err instanceof AiError) {
      await recordUsage(usage, err.calls);
      if (err.kind !== "retryable") return markWorksheetFailed(ws.id, err.userMessage);
    }
    throw err;
  }
  await recordUsage(usage, result.calls);
  if (!result.value.readable) {
    return markWorksheetFailed(ws.id, result.value.problem || "Claude couldn't find questions in this PDF.");
  }
  const items = normalizeWorksheet(result.value, pages.length);
  if (items.length === 0) return markWorksheetFailed(ws.id, "Claude couldn't find any questions in this PDF.");
  await db.$transaction([
    db.worksheetItem.deleteMany({ where: { worksheetId: ws.id } }),
    db.worksheetItem.createMany({ data: items.map((it, order) => ({ ...it, worksheetId: ws.id, order })) }),
    db.worksheet.update({ where: { id: ws.id }, data: { status: "READY", error: null, hasAnswerKey: result.value.hasAnswerKey } }),
  ]);
  return "read";
}

