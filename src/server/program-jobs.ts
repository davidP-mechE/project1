import "server-only";
import { refreshStaffNotices } from "./notifications";
import { awardBadgesForActive } from "./badges";
import { db } from "./db";
import { env } from "./env";
import { sendEmail } from "./email";
import { staffDigestMessage } from "./email/templates";
import { classAlerts } from "./cohort";
import { generateSummary } from "./assistant";
import { runBackup } from "./backups";
import { recordError } from "./monitoring";
import { buildWeeklyBatches } from "./auto-practice";

/**
 * Scheduled program emails, run hourly by the worker. Each is sent at most
 * once (keys in SentNotice), so a missed or repeated hour can't double-send.
 *  - Staff who opted in get a daily digest of new alerts at 7am their time.
 */

async function once(key: string) {
  try {
    await db.sentNotice.create({ data: { key } });
    return true;
  } catch {
    return false; // already sent
  }
}

const localHour = (tz: string, now: Date) => {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  } catch {
    return now.getUTCHours();
  }
};

export async function sendStaffDigests(now = new Date()) {
  const staff = await db.user.findMany({ where: { staffDigest: true, OR: [{ programsAdmin: { some: {} } }, { classStaff: { some: {} } }] }, select: { id: true, email: true, name: true, timezone: true } });
  let sent = 0;
  for (const u of staff) {
    if (localHour(u.timezone, now) !== 7) continue;
    const classes = await db.class.findMany({ where: { archivedAt: null, OR: [{ program: { adminId: u.id } }, { staff: { some: { userId: u.id, role: { not: "VIEWER" } } } }] }, select: { id: true, name: true } });
    const lines: { className: string; count: number; examples: string[] }[] = [];
    for (const c of classes) {
      const a = await classAlerts(u.id, c.id, now).catch(() => null);
      if (a && a.alerts.length) lines.push({ className: c.name, count: a.alerts.length, examples: a.alerts.slice(0, 3).map((x) => `${x.name}: ${x.detail}`) });
    }
    if (!lines.length) continue;
    if (!(await once(`digest:${u.id}:${now.toISOString().slice(0, 10)}`))) continue;
    await sendEmail(staffDigestMessage({ to: u.email, lines, url: `${env.APP_URL}/teach` })).catch((err) => console.warn("[jobs] digest not sent:", err instanceof Error ? err.message : err));
    sent++;
  }
  return sent;
}

/** Sunday 20:00 UTC: the assistant's weekly summary for each class with a published curriculum and some activity. */
export async function writeWeeklySummaries(now = new Date(), opts: { force?: boolean } = {}) {
  if (!opts.force && !(now.getUTCDay() === 0 && now.getUTCHours() === 20)) return 0;
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const classes = await db.class.findMany({
    where: { archivedAt: null, curricula: { some: { status: "ACTIVE" } }, assignments: { some: { answers: { some: { createdAt: { gte: since } } } } } },
    select: { id: true, program: { select: { adminId: true } } },
  });
  let n = 0;
  for (const c of classes) {
    if (!(await once(`summary:${c.id}:${now.toISOString().slice(0, 10)}`))) continue;
    await generateSummary(c.program.adminId, c.id, {}, {}, now).then(() => n++).catch((err) => console.warn("[jobs] summary not written:", err instanceof Error ? err.message : err));
  }
  return n;
}

export async function runProgramJobs(now = new Date()) {
  const [digests, weekly] = await Promise.all([sendStaffDigests(now), writeWeeklySummaries(now)]);
  // Weekly auto-assigned practice: any class without this week's batch gets one (rules only, no AI).
  await buildWeeklyBatches(now).catch((err) => recordError({ kind: "worker", message: `Weekly practice failed: ${err instanceof Error ? err.message : String(err)}`, path: "worker:auto-practice" }));
  await awardBadgesForActive(now).catch((err) => recordError({ kind: "worker", message: `Badges failed: ${err instanceof Error ? err.message : String(err)}`, path: "worker:badges" }));
  await refreshStaffNotices(now).catch((err) => recordError({ kind: "worker", message: `Staff notices failed: ${err instanceof Error ? err.message : String(err)}`, path: "worker:notices" }));
  const backup = await runBackup(now).catch(async (err) => {
    await recordError({ kind: "worker", message: `Backup failed: ${err instanceof Error ? err.message : String(err)}`, path: "worker:backup" });
    return null;
  });
  if (backup) console.info(`[backup] saved ${backup.key} (${backup.bytes} bytes)`);
  return { digests, summaries: weekly };
}
