import "server-only";
import { db } from "./db";
import { cleanupAbandonedUploads } from "./courses";
import { cleanupAttachments } from "./message-attachments";
import { purgeExpiredUploads } from "./academic-index";

/**
 * Hourly housekeeping, run by the worker: removes uploads that were started
 * but never finished, expired login rate-limit rows, old feature counts, and
 * files attached to messages that were never sent, and Academic Index PDFs
 * 24 hours after upload (if the student never confirmed their review).
 */
export async function runMaintenance(now = new Date()) {
  const uploads = await cleanupAbandonedUploads(24);
  const dayAgo = BigInt(now.getTime() - 24 * 60 * 60 * 1000);
  const { count: rateRows } = await db.rateLimit.deleteMany({ where: { lastRequest: { lt: dayAgo } } });
  const yearAgo = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
  const { count: events } = await db.analyticsEvent.deleteMany({ where: { createdAt: { lt: yearAgo } } });
  const { count: verifications } = await db.verification.deleteMany({ where: { expiresAt: { lt: now } } });
  // Files attached to a message but never sent.
  const { removed: attachments } = await cleanupAttachments(now);
  // Academic Index: raw application PDFs are never kept longer than 24 hours.
  const academicUploads = await purgeExpiredUploads(now);
  return { uploads, rateRows, events, verifications, attachments, academicUploads };
}
