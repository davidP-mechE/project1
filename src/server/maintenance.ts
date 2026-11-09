import "server-only";
import { db } from "./db";
import { cleanupAbandonedUploads } from "./courses";

/**
 * Hourly housekeeping, run by the worker: removes uploads that were started
 * but never finished, expired login rate-limit rows, and old feature counts.
 */
export async function runMaintenance(now = new Date()) {
  const uploads = await cleanupAbandonedUploads(24);
  const dayAgo = BigInt(now.getTime() - 24 * 60 * 60 * 1000);
  const { count: rateRows } = await db.rateLimit.deleteMany({ where: { lastRequest: { lt: dayAgo } } });
  const yearAgo = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
  const { count: events } = await db.analyticsEvent.deleteMany({ where: { createdAt: { lt: yearAgo } } });
  const { count: verifications } = await db.verification.deleteMany({ where: { expiresAt: { lt: now } } });
  return { uploads, rateRows, events, verifications };
}
