import "server-only";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { storage } from "./storage";
import { db } from "./db";

/**
 * Nightly database backups, independent of the database host's own: a
 * pg_dump of the whole database, gzipped, into private file storage under
 * backups/YYYY-MM-DD.sql.gz, keeping 30 days. Opt in with BACKUPS_ENABLED=true
 * on the worker (which needs the pg_dump tool installed). Restoring is a manual
 * step: see ADMIN_GUIDE.md ("Backups").
 */

export const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
export const backupKey = (d: Date) => `backups/${d.toISOString().slice(0, 10)}.sql.gz`;

function dump(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["--no-owner", "--no-privileges", "--format=plain", databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => (err += b.toString()));
    child.on("error", (e) => reject(new Error(`pg_dump couldn't start (is postgresql-client installed?): ${e.message}`)));
    // pg_dump's errors can include the connection string's host; never the password (it's in the URL only).
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`pg_dump failed (${code}): ${err.replace(/postgres(ql)?:\/\/\S+/g, "[database]").slice(0, 300)}`))));
  });
}

/** Take today's backup (once a day; at 03:00 UTC from the worker) and drop ones past the retention window. */
export async function runBackup(now = new Date(), opts: { force?: boolean; dumper?: (url: string) => Promise<Buffer> } = {}) {
  if (!opts.force && (process.env.BACKUPS_ENABLED !== "true" || now.getUTCHours() !== 3)) return null;
  const key = backupKey(now);
  try {
    await db.sentNotice.create({ data: { key: `backup:${key}` } });
  } catch {
    if (!opts.force) return null; // already done today
  }
  const sql = await (opts.dumper ?? dump)(process.env.DATABASE_URL!);
  await storage.put(key, gzipSync(sql), "application/gzip");
  // Drop the backups that just aged out (a few days back, in case the worker was down).
  for (let d = RETENTION_DAYS; d < RETENTION_DAYS + 7; d++) await storage.delete(backupKey(new Date(now.getTime() - d * 86_400_000))).catch(() => {});
  return { key, bytes: sql.length };
}
