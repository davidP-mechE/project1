import "server-only";
import { db } from "./db";
import { ClassError } from "./access";
import { NotFoundError, RateLimitError } from "./courses";
import { threadViewer } from "./messages";
import { storage, storageKeys } from "./storage";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, SNIFF_BYTES, claimedType, cleanFilename, sniffType } from "@/lib/files/sniff";

/**
 * Files in conversations: PNG, JPG or PDF, up to 10 MB each.
 *
 * 1. createAttachmentUpload: a participant who can reply gets a short-lived
 *    upload URL (the file goes straight to storage, not through the web app).
 * 2. completeAttachmentUpload: the size must match and the first bytes must
 *    be a real PNG, JPEG or PDF of the type the name says; otherwise the file
 *    is deleted.
 * 3. sendMessage links ready files to the message.
 * 4. readAttachment serves it after the same check as reading the thread:
 *    the two participants (staff while still in scope) and the program admin.
 *
 * Files never sent are removed by the worker after a day (cleanupAttachments).
 */

const UPLOADS_PER_HOUR = 30;

const notFound = () => new NotFoundError("File not found");

export async function createAttachmentUpload(userId: string, threadId: string, input: { filename: string; size: number; contentType: string }, now = new Date()) {
  const { viewer } = await threadViewer(userId, threadId);
  if (viewer.mode === "admin" || !viewer.canReply) throw new ClassError("You can't send files in this conversation.", 403);
  const type = claimedType(input.filename, input.contentType);
  if (!type) throw new ClassError("Attach a PNG, JPG or PDF.");
  if (!Number.isInteger(input.size) || input.size <= 0) throw new ClassError("That file is empty.");
  if (input.size > MAX_ATTACHMENT_BYTES) throw new ClassError("Files can be up to 10 MB.");
  const recent = await db.messageAttachment.count({ where: { uploaderId: userId, createdAt: { gte: new Date(now.getTime() - 3600_000) } } });
  if (recent >= UPLOADS_PER_HOUR) throw new RateLimitError("You've attached a lot of files in the last hour. Try again a little later.");
  const row = await db.messageAttachment.create({ data: { threadId, uploaderId: userId, fileKey: `pending-${crypto.randomUUID()}`, filename: cleanFilename(input.filename), contentType: type, sizeBytes: input.size, createdAt: now } });
  const fileKey = storageKeys.messageAttachment(userId, row.id);
  await db.messageAttachment.update({ where: { id: row.id }, data: { fileKey } });
  const upload = await storage.createUploadUrl(fileKey, { contentType: type, contentLength: input.size, expiresInSeconds: 900 });
  return { attachmentId: row.id, upload };
}

export async function completeAttachmentUpload(userId: string, attachmentId: string): Promise<{ ok: true; attachment: { id: string; filename: string; contentType: string; sizeBytes: number } } | { ok: false; error: string }> {
  const a = await db.messageAttachment.findFirst({ where: { id: attachmentId, uploaderId: userId, messageId: null } });
  if (!a) throw notFound();
  const done = { ok: true as const, attachment: { id: a.id, filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes } };
  if (a.status === "READY") return done;
  const fail = async (error: string) => {
    await storage.delete(a.fileKey).catch(() => {});
    await db.messageAttachment.delete({ where: { id: a.id } }).catch(() => {});
    return { ok: false as const, error };
  };
  const stored = await storage.head(a.fileKey);
  if (!stored) return fail("The upload didn't finish. Please try again.");
  if (stored.size !== a.sizeBytes || stored.size > MAX_ATTACHMENT_BYTES) return fail("The uploaded file size doesn't match. Please try again.");
  const real = sniffType(await storage.readRange(a.fileKey, 0, Math.min(SNIFF_BYTES, stored.size) - 1));
  if (!real) return fail("That file isn't a real PNG, JPG or PDF.");
  if (real !== a.contentType) return fail(`That file's name says ${a.contentType.split("/")[1].toUpperCase()} but it's really a ${real.split("/")[1].toUpperCase()}. Rename it and try again.`);
  await db.messageAttachment.update({ where: { id: a.id }, data: { status: "READY" } });
  return done;
}

/** Remove a file you attached but haven't sent. */
export async function discardAttachment(userId: string, attachmentId: string) {
  const a = await db.messageAttachment.findFirst({ where: { id: attachmentId, uploaderId: userId, messageId: null } });
  if (!a) throw notFound();
  await storage.delete(a.fileKey).catch(() => {});
  await db.messageAttachment.delete({ where: { id: a.id } });
}

/** A file's bytes, for someone who can read its conversation. Unsent files only for their uploader. */
export async function readAttachment(userId: string, attachmentId: string) {
  const a = await db.messageAttachment.findUnique({ where: { id: attachmentId } });
  if (!a || a.status !== "READY" || !(ATTACHMENT_TYPES as readonly string[]).includes(a.contentType)) throw notFound();
  if (!a.messageId && a.uploaderId !== userId) throw notFound();
  try {
    await threadViewer(userId, a.threadId);
  } catch (err) {
    if (err instanceof NotFoundError) throw notFound();
    throw err;
  }
  const body = await storage.getBuffer(a.fileKey).catch(() => null);
  if (!body) throw notFound();
  return { body, contentType: a.contentType, filename: a.filename };
}

/** Worker: delete files that were uploaded (or started) more than a day ago and never sent. */
export async function cleanupAttachments(now = new Date()) {
  const stale = await db.messageAttachment.findMany({ where: { messageId: null, createdAt: { lt: new Date(now.getTime() - 86_400_000) } }, select: { id: true, fileKey: true }, take: 500 });
  for (const a of stale) {
    await storage.delete(a.fileKey).catch(() => {});
    await db.messageAttachment.delete({ where: { id: a.id } }).catch(() => {});
  }
  return { removed: stale.length };
}

/** Files to delete from storage before a thread or message goes (rows cascade; files don't). */
export async function attachmentKeys(where: { threadId?: string; messageId?: string }) {
  return (await db.messageAttachment.findMany({ where, select: { fileKey: true } })).map((a) => a.fileKey);
}
