import "server-only";
import { db } from "./db";
import { env } from "./env";
import { sendEmail } from "./email";
import { guardianSummaryMessage, staffDigestMessage } from "./email/templates";
import { classAlerts } from "./cohort";
import { myClasses } from "./classes";
import { domainAccuracy } from "./pacing";
import { domainName } from "@/lib/sat/domains";

/**
 * Scheduled program emails, run hourly by the worker. Each is sent at most
 * once (keys in SentNotice), so a missed or repeated hour can't double-send.
 *  - Staff who opted in get a daily digest of new alerts at 7am their time.
 *  - Guardians who agreed get a weekly summary on Sunday evening (17:00 UTC),
 *    for classes that turned it on. Fixed wording from the data; no AI.
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

/** ISO week key (e.g. 2026-W46), so a summary goes once a week. */
function weekKey(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y.getTime()) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}

export async function sendGuardianSummaries(now = new Date(), opts: { force?: boolean } = {}) {
  if (!opts.force && !(now.getUTCDay() === 0 && now.getUTCHours() === 17)) return 0;
  const week = weekKey(now);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const guardians = await db.guardianContact.findMany({
    where: { unsubscribedAt: null, student: { classMemberships: { some: { class: { guardianSummaries: true, archivedAt: null } } } } },
    include: { student: { select: { id: true, name: true } } },
  });
  let sent = 0;
  for (const g of guardians) {
    if (g.lastSentOn === week) continue;
    const classes = await myClasses(g.studentId, now);
    const enabled = await db.class.findMany({ where: { id: { in: classes.map((c) => c.id) }, guardianSummaries: true }, select: { id: true } });
    const on = new Set(enabled.map((c) => c.id));
    const work = classes.filter((c) => on.has(c.id)).flatMap((c) => c.assignments);
    const doneThisWeek = work.filter((a) => a.cell.status === "done" && a.cell.lastActive && a.cell.lastActive >= since).length;
    const overdue = work.filter((a) => a.dueAt && a.dueAt < now && a.cell.status !== "done").map((a) => a.title);
    const attendance = await db.attendanceRecord.findMany({ where: { studentId: g.studentId, session: { startsAt: { gte: since, lte: now }, classId: { in: [...on] } } }, select: { status: true } });
    const latest = await db.scoreRecord.findFirst({ where: { studentId: g.studentId }, orderBy: [{ takenOn: "desc" }, { createdAt: "desc" }], select: { total: true, source: true } });
    const acc = await domainAccuracy(g.studentId, now);
    const weakest = Object.entries(acc).filter(([, v]) => v !== null).sort((a, b) => a[1]! - b[1]!)[0];
    const claimed = await db.guardianContact.updateMany({ where: { id: g.id, OR: [{ lastSentOn: null }, { lastSentOn: { not: week } }] }, data: { lastSentOn: week } });
    if (!claimed.count) continue;
    await sendEmail(
      guardianSummaryMessage({
        to: g.email,
        guardianName: g.name,
        studentName: g.student.name || "Your student",
        doneThisWeek,
        overdue,
        attended: attendance.filter((r) => r.status === "PRESENT" || r.status === "LATE").length,
        sessions: attendance.filter((r) => r.status !== "EXCUSED").length,
        latestScore: latest ? `${latest.total}${latest.source === "DIAGNOSTIC" || latest.source.startsWith("PRACTICE") ? " (practice estimate)" : ""}` : null,
        focus: weakest ? domainName(weakest[0]) : null,
        unsubscribeUrl: `${env.APP_URL}/unsubscribe/${g.unsubToken}`,
      }),
    ).catch((err) => console.warn("[jobs] guardian summary not sent:", err instanceof Error ? err.message : err));
    sent++;
  }
  return sent;
}

export async function runProgramJobs(now = new Date()) {
  const [digests, summaries] = await Promise.all([sendStaffDigests(now), sendGuardianSummaries(now)]);
  return { digests, summaries };
}
