import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { sendEmail } from "./email";
import { errorAlertMessage, problemReportMessage } from "./email/templates";

/**
 * Error monitoring without a third-party service: server errors (from
 * src/instrumentation.ts), browser errors and the worker's failures are
 * grouped by fingerprint in the database, and the site admins are emailed
 * the first time an error appears (and again at most once an hour while it
 * keeps happening). Nothing personal is stored: email addresses and long
 * numbers are removed from messages, and paths lose their query strings.
 */

const ALERT_EVERY_MS = 60 * 60_000;

/** Remove things that could identify a person, and anything after "?" in a path. */
export function scrub(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .replace(/(password|token|secret|key)=\S+/gi, "$1=[hidden]")
    .slice(0, 500);
}
export const scrubPath = (p: string) => p.split("?")[0].split("#")[0].slice(0, 200);
/** Group /teach/abc123/scores and /teach/def456/scores together. */
const pathPattern = (p: string) => scrubPath(p).replace(/\/c[a-z0-9]{20,}/g, "/:id").replace(/\/[0-9a-f-]{20,}/g, "/:id");

export async function recordError(input: { kind: "server" | "client" | "worker" | "action"; message: string; path: string; digest?: string | null }, now = new Date()) {
  const message = scrub(input.message || "Unknown error");
  const path = scrubPath(input.path || "");
  const fingerprint = createHash("sha256").update(`${input.kind}|${message.replace(/\d+/g, "#")}|${pathPattern(path)}`).digest("hex").slice(0, 40);
  const row = await db.errorEvent.upsert({
    where: { fingerprint },
    create: { fingerprint, kind: input.kind, message, path, digest: input.digest ?? null, firstAt: now, lastAt: now },
    update: { count: { increment: 1 }, lastAt: now, digest: input.digest ?? undefined, resolvedAt: null },
  });
  // Alert on the first one, then at most once an hour while it continues.
  if (!row.alertedAt || now.getTime() - row.alertedAt.getTime() >= ALERT_EVERY_MS) {
    const claimed = await db.errorEvent.updateMany({ where: { id: row.id, OR: [{ alertedAt: null }, { alertedAt: { lte: new Date(now.getTime() - ALERT_EVERY_MS) } }] }, data: { alertedAt: now } });
    if (claimed.count) {
      const admins = await db.user.findMany({ where: { role: { in: ["ADMIN", "OWNER"] } }, select: { email: true } });
      for (const a of admins) await sendEmail(errorAlertMessage({ to: a.email, kind: row.kind, message: row.message, path: row.path, count: row.count, url: `${env.APP_URL}/admin` })).catch(() => {});
    }
  }
  return row.id;
}

/** "Report a problem": the page, the browser, and recent error ids. Site admins are emailed. */
export async function reportProblem(userId: string | null, input: { path: string; userAgent: string; errorIds: string[]; note: string }) {
  const r = await db.problemReport.create({
    data: { userId, path: scrubPath(input.path), userAgent: input.userAgent.slice(0, 300), errorIds: input.errorIds.slice(0, 10).map((e) => e.slice(0, 64)), note: scrub(input.note.slice(0, 2000)) },
  });
  const admins = await db.user.findMany({ where: { role: { in: ["ADMIN", "OWNER"] } }, select: { email: true } });
  for (const a of admins) await sendEmail(problemReportMessage({ to: a.email, path: r.path, note: r.note, errorIds: r.errorIds, userAgent: r.userAgent, url: `${env.APP_URL}/admin` })).catch(() => {});
  return r.id;
}

export async function listProblems() {
  const [errors, reports] = await Promise.all([
    db.errorEvent.findMany({ where: { resolvedAt: null }, orderBy: { lastAt: "desc" }, take: 50 }),
    db.problemReport.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { errors, reports };
}

export async function resolveProblem(kind: "error" | "report", id: string, now = new Date()) {
  if (kind === "error") await db.errorEvent.updateMany({ where: { id }, data: { resolvedAt: now } });
  else await db.problemReport.updateMany({ where: { id }, data: { resolvedAt: now } });
}
