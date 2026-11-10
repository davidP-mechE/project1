import "server-only";
import { db } from "./db";
import { enqueueGeneration } from "./queue";
import { storage, storageKeys } from "./storage";
import { NotFoundError } from "./courses";
import { assertCanUpload, ensureAiBudget, LimitError } from "./limits";
import { rateLimit } from "./rate-limit";
import { recordUsage } from "./usage";
import { AiError, type LessonWriter } from "./ai/writer";
import { PdfOpenError, PdfReader } from "./processing/pdf-reader";
import { checkPdfSignature, PDF_HEAD_BYTES, PDF_TAIL_BYTES } from "@/lib/pdf/validate";
import { titleFromFilename, validateUploadRequest } from "@/lib/upload/limits";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { MAX_WORKSHEET_PAGES, normalizeWorksheet, type WorksheetPage } from "@/lib/ai/worksheet";

/**
 * Worksheets: a teacher uploads a PDF of questions (homework, a problem set, a
 * practice test). The worker shows Claude every page and saves the questions
 * it lists, with answers (from the worksheet's answer key, or worked out and
 * marked for the teacher to check). The teacher reviews and edits them, then
 * turns them into one or more assignments (src/server/classes.ts).
 */

export class WorksheetError extends Error {}

const PAGE_IMAGE_WIDTH = 1100; // readable equations without huge images

/** Step 1: check the upload and hand back a URL to put the PDF at. */
export async function createWorksheetUpload(userId: string, input: { filename: string; size: number; contentType: string; rightsConfirmed: boolean }) {
  const check = validateUploadRequest({ ...input, kind: "book" });
  if (!check.ok) throw new WorksheetError(check.error.replace("this textbook", "this worksheet"));
  const limited = await rateLimit(RATE_RULES.worksheetUpload, userId);
  if (!limited.ok) throw new WorksheetError(`You've uploaded a lot of worksheets in the last hour. Please try again in ${Math.ceil(limited.retryAfterSeconds / 60)} minutes.`);
  try {
    await assertCanUpload(userId, input.size);
  } catch (err) {
    if (err instanceof LimitError) throw new WorksheetError(err.message);
    throw err;
  }
  const ws = await db.worksheet.create({
    data: { ownerId: userId, title: titleFromFilename(input.filename), fileKey: `pending-${crypto.randomUUID()}`, sizeBytes: BigInt(input.size) },
  });
  const fileKey = storageKeys.worksheet(userId, ws.id);
  await db.worksheet.update({ where: { id: ws.id }, data: { fileKey } });
  const upload = await storage.createUploadUrl(fileKey, { contentType: "application/pdf", contentLength: input.size, expiresInSeconds: 3600 });
  return { worksheetId: ws.id, upload };
}

/** Step 3: the PDF is uploaded; check it and have it read. */
export async function completeWorksheetUpload(userId: string, worksheetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = await db.worksheet.findFirst({ where: { id: worksheetId, ownerId: userId } });
  if (!ws) throw new NotFoundError("Worksheet not found");
  if (ws.status !== "UPLOADING") return { ok: true };
  const fail = async (error: string) => {
    await storage.delete(ws.fileKey).catch(() => {});
    await db.worksheet.update({ where: { id: ws.id }, data: { status: "FAILED", error } });
    return { ok: false as const, error };
  };
  const stored = await storage.head(ws.fileKey);
  if (!stored) return fail("The upload didn't finish. Please try again.");
  if (stored.size !== Number(ws.sizeBytes)) return fail("The uploaded file size doesn't match. Please try again.");
  const head = await storage.readRange(ws.fileKey, 0, PDF_HEAD_BYTES - 1);
  const tail = await storage.readRange(ws.fileKey, Math.max(0, stored.size - PDF_TAIL_BYTES), stored.size - 1);
  const check = checkPdfSignature(head, tail);
  if (!check.ok) return fail(check.reason);
  await db.worksheet.update({ where: { id: ws.id }, data: { status: "READING", error: null } });
  await enqueueGeneration([{ payload: { kind: "worksheet", worksheetId: ws.id }, priority: 2 }]);
  return { ok: true };
}

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

export async function markWorksheetFailed(worksheetId: string, error: string) {
  await db.worksheet.updateMany({ where: { id: worksheetId }, data: { status: "FAILED", error } });
  return "failed" as const;
}

export async function listWorksheets(userId: string) {
  return db.worksheet.findMany({
    where: { ownerId: userId, status: { not: "UPLOADING" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, error: true, pageCount: true, createdAt: true, hasAnswerKey: true, _count: { select: { items: true, assignments: true } } },
  });
}

/** A worksheet with its questions, for its owner. */
export async function getWorksheet(userId: string, worksheetId: string) {
  const ws = await db.worksheet.findFirst({
    where: { id: worksheetId, ownerId: userId },
    include: {
      items: { orderBy: { order: "asc" } },
      assignments: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, itemIds: true, dueAt: true, class: { select: { id: true, name: true } } } },
    },
  });
  if (!ws) throw new NotFoundError("Worksheet not found");
  return ws;
}

export type ItemEdit = {
  type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP";
  prompt: string;
  choices: string[];
  correctChoice: number | null;
  answer: string;
  explanation: string;
  topic: string;
};

/** The teacher fixes a question or its answer. Their answer is then the answer key. */
export async function updateWorksheetItem(userId: string, itemId: string, edit: ItemEdit) {
  const item = await db.worksheetItem.findFirst({ where: { id: itemId, worksheet: { ownerId: userId } }, select: { id: true } });
  if (!item) throw new NotFoundError("Question not found");
  const prompt = edit.prompt.trim();
  if (!prompt) throw new WorksheetError("The question can't be empty.");
  const choices = edit.choices.map((c) => c.trim()).filter(Boolean);
  if (edit.type === "MULTIPLE_CHOICE") {
    if (choices.length < 2) throw new WorksheetError("A multiple-choice question needs at least 2 choices.");
    if (edit.correctChoice === null || edit.correctChoice < 0 || edit.correctChoice >= choices.length) throw new WorksheetError("Pick the right choice.");
  } else if (!edit.answer.trim()) {
    throw new WorksheetError("Add the answer, so students' answers can be checked.");
  }
  await db.worksheetItem.update({
    where: { id: itemId },
    data: {
      type: edit.type,
      prompt: prompt.slice(0, 20_000),
      choices: edit.type === "MULTIPLE_CHOICE" ? choices : [],
      correctChoice: edit.type === "MULTIPLE_CHOICE" ? edit.correctChoice : null,
      answer: (edit.type === "MULTIPLE_CHOICE" ? choices[edit.correctChoice!] : edit.answer.trim()).slice(0, 5_000),
      explanation: edit.explanation.trim().slice(0, 5_000),
      steps: edit.type === "STEP_BY_STEP" ? undefined : [],
      topic: edit.topic.trim().slice(0, 60) || "General",
      answerSource: "TEACHER",
    },
  });
}

export async function deleteWorksheetItem(userId: string, itemId: string) {
  const item = await db.worksheetItem.findFirst({ where: { id: itemId, worksheet: { ownerId: userId } }, select: { id: true } });
  if (!item) throw new NotFoundError("Question not found");
  await db.worksheetItem.delete({ where: { id: itemId } });
}

export async function renameWorksheet(userId: string, worksheetId: string, title: string) {
  const t = title.trim().slice(0, 200);
  if (!t) throw new WorksheetError("Give the worksheet a name.");
  const { count } = await db.worksheet.updateMany({ where: { id: worksheetId, ownerId: userId }, data: { title: t } });
  if (count === 0) throw new NotFoundError("Worksheet not found");
}

/** Deleting a worksheet keeps assignments already made from it working (their questions are removed with it, so they're hidden). */
export async function deleteWorksheet(userId: string, worksheetId: string) {
  const ws = await db.worksheet.findFirst({ where: { id: worksheetId, ownerId: userId }, select: { id: true, fileKey: true, _count: { select: { assignments: true } } } });
  if (!ws) throw new NotFoundError("Worksheet not found");
  if (ws._count.assignments > 0) throw new WorksheetError("This worksheet is used by assignments. Delete those assignments first.");
  await storage.delete(ws.fileKey).catch(() => {});
  await db.worksheet.delete({ where: { id: ws.id } });
}

/** Try reading a worksheet again (e.g. after Claude was busy). */
export async function retryWorksheet(userId: string, worksheetId: string) {
  const ws = await db.worksheet.findFirst({ where: { id: worksheetId, ownerId: userId }, select: { id: true, status: true, fileKey: true } });
  if (!ws) throw new NotFoundError("Worksheet not found");
  if (ws.status !== "FAILED") return;
  if (!(await storage.head(ws.fileKey))) throw new WorksheetError("The PDF is no longer stored. Upload it again.");
  await db.worksheet.update({ where: { id: ws.id }, data: { status: "READING", error: null } });
  await enqueueGeneration([{ payload: { kind: "worksheet", worksheetId: ws.id }, priority: 2 }]);
}
