import "server-only";
import { isNoAi, NO_AI_MESSAGE } from "./program-access";
import { db } from "./db";
import { enqueueGeneration } from "./queue";
import { storage, storageKeys } from "./storage";
import { NotFoundError } from "./courses";
import { assertCanUpload, LimitError } from "./limits";
import { rateLimit } from "./rate-limit";
import { checkPdfSignature, PDF_HEAD_BYTES, PDF_TAIL_BYTES } from "@/lib/pdf/validate";
import { titleFromFilename, validateUploadRequest } from "@/lib/upload/limits";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { cleanTags } from "@/lib/sat/domains";

/**
 * Worksheets: a teacher uploads a PDF of questions (homework, a problem set, a
 * practice test). The worker shows Claude every page and saves the questions
 * it lists, with answers (from the worksheet's answer key, or worked out and
 * marked for the teacher to check). The teacher reviews and edits them, then
 * turns them into one or more assignments (src/server/classes.ts).
 */

export class WorksheetError extends Error {}

/** Step 1: check the upload and hand back a URL to put the PDF at. */
export async function createWorksheetUpload(userId: string, input: { filename: string; size: number; contentType: string; rightsConfirmed: boolean }) {
  if (await isNoAi(userId)) throw new WorksheetError(NO_AI_MESSAGE);
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

export async function markWorksheetFailed(worksheetId: string, error: string) {
  await db.worksheet.updateMany({ where: { id: worksheetId }, data: { status: "FAILED", error } });
  return "failed" as const;
}

const WORKSHEET_PAGE = 30;

/** The person's worksheets, newest first, 30 a page (`before`: the last id shown). */
export async function listWorksheets(userId: string, opts: { before?: string } = {}) {
  const rows = await db.worksheet.findMany({
    where: { ownerId: userId, status: { not: "UPLOADING" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: WORKSHEET_PAGE + 1,
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    select: { id: true, title: true, status: true, error: true, pageCount: true, createdAt: true, hasAnswerKey: true, _count: { select: { items: true, assignments: true } } },
  });
  const page = rows.slice(0, WORKSHEET_PAGE);
  return Object.assign(page, { older: rows.length > WORKSHEET_PAGE ? page.at(-1)!.id : null });
}

/** A worksheet with its questions, for its owner. */
export async function getWorksheet(userId: string, worksheetId: string) {
  const ws = await db.worksheet.findFirst({
    where: { id: worksheetId, ownerId: userId },
    include: {
      items: { where: { archivedAt: null }, orderBy: { order: "asc" }, include: { _count: { select: { answers: true, versions: true } } } },
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

/**
 * The teacher fixes a question or its answer. Their answer is then the answer key.
 * If students already answered this version, the old one is kept and the
 * question gets a new version: past answers keep their grades (re-grading is a
 * separate, explicit step).
 */
export async function updateWorksheetItem(userId: string, itemId: string, edit: ItemEdit) {
  const item = await db.worksheetItem.findFirst({ where: { id: itemId, worksheet: { ownerId: userId } } });
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
  const data = {
      type: edit.type,
      prompt: prompt.slice(0, 20_000),
      choices: edit.type === "MULTIPLE_CHOICE" ? choices : [],
      correctChoice: edit.type === "MULTIPLE_CHOICE" ? edit.correctChoice : null,
      answer: (edit.type === "MULTIPLE_CHOICE" ? choices[edit.correctChoice!] : edit.answer.trim()).slice(0, 5_000),
      explanation: edit.explanation.trim().slice(0, 5_000),
      steps: edit.type === "STEP_BY_STEP" ? undefined : [],
      topic: edit.topic.trim().slice(0, 60) || "General",
      answerSource: "TEACHER",
  };
  const answered = await db.assignmentAnswer.count({ where: { itemId, itemVersion: item.version } });
  const changed =
    data.type !== item.type ||
    data.prompt !== item.prompt ||
    data.answer !== item.answer ||
    data.correctChoice !== item.correctChoice ||
    data.explanation !== item.explanation ||
    JSON.stringify(data.choices) !== JSON.stringify(item.choices);
  await db.$transaction(async (tx) => {
    if (answered > 0 && changed) {
      await tx.worksheetItemVersion.create({
        data: { itemId, version: item.version, type: item.type, prompt: item.prompt, choices: item.choices, correctChoice: item.correctChoice, answer: item.answer, explanation: item.explanation, steps: item.steps, editedById: userId },
      });
    }
    await tx.worksheetItem.update({ where: { id: itemId }, data: { ...data, ...(answered > 0 && changed ? { version: item.version + 1 } : {}) } });
  });
}

/** Remove a question. If students answered it, it's archived instead, so their answers and grades stay. */
export async function deleteWorksheetItem(userId: string, itemId: string) {
  const item = await db.worksheetItem.findFirst({ where: { id: itemId, worksheet: { ownerId: userId } }, select: { id: true, _count: { select: { answers: true } } } });
  if (!item) throw new NotFoundError("Question not found");
  if (item._count.answers > 0) await db.worksheetItem.update({ where: { id: itemId }, data: { archivedAt: new Date() } });
  else await db.worksheetItem.delete({ where: { id: itemId } });
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
  if (await isNoAi(userId)) throw new WorksheetError(NO_AI_MESSAGE);
  if (!(await storage.head(ws.fileKey))) throw new WorksheetError("The PDF is no longer stored. Upload it again.");
  await db.worksheet.update({ where: { id: ws.id }, data: { status: "READING", error: null } });
  await enqueueGeneration([{ payload: { kind: "worksheet", worksheetId: ws.id }, priority: 2 }]);
}

export type TagEdit = { domain: string | null; skill: string | null; difficulty: string | null; desmosSolvable: boolean };

/** The teacher sets (and so confirms) a question's SAT tags. */
export async function setItemTags(userId: string, itemId: string, edit: TagEdit) {
  const item = await db.worksheetItem.findFirst({ where: { id: itemId, worksheet: { ownerId: userId } }, select: { id: true } });
  if (!item) throw new NotFoundError("Question not found");
  const t = cleanTags({ domain: edit.domain, skill: edit.skill, difficulty: edit.difficulty });
  if (edit.domain && !t.domain) throw new WorksheetError("Choose a subject from the list.");
  await db.worksheetItem.update({ where: { id: itemId }, data: { ...t, desmosSolvable: t.section === "MATH" && edit.desmosSolvable, tagsConfirmed: true } });
}

/** Accept every suggested tag on a worksheet at once. */
export async function confirmAllTags(userId: string, worksheetId: string) {
  const { count } = await db.worksheet.updateMany({ where: { id: worksheetId, ownerId: userId }, data: {} });
  if (count === 0) throw new NotFoundError("Worksheet not found");
  await db.worksheetItem.updateMany({ where: { worksheetId, tagsConfirmed: false }, data: { tagsConfirmed: true } });
}
