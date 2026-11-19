import "server-only";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { classAccess, ClassError, studentInScope } from "./access";
import { audit } from "./programs";
import { sendEmail } from "./email";
import { guardianProgressMessage, type GuardianProgress } from "./email/templates";
import { skillStats } from "./skill-stats";
import { weakSkills } from "@/lib/practice/auto";
import { projectScore, SOURCE_LABEL, type ScoreSource } from "@/lib/sat/scores";
import { formatInZone } from "@/lib/dates";

/**
 * Parent progress emails. The program admin turns them on (weekly or monthly).
 * Each guardian with recorded consent who hasn't unsubscribed gets one per
 * period: practice time, questions answered, the accuracy trend, the latest
 * score or estimate, a focus skill for next week and the upcoming test date.
 * Weekly ones go from Sunday 17:00 UTC; monthly ones from the 1st at 17:00
 * UTC. The worker sends at most GUARDIAN_EMAILS_PER_HOUR an hour and carries
 * on the next hours, so a big program is spread out. Each email has its own
 * unsubscribe link. No AI.
 */

export type Frequency = "OFF" | "WEEKLY" | "MONTHLY";
const DAY = 86_400_000;
const SEND_HOUR = 17;
/** A period's emails can still go out this long after it starts (e.g. the worker was down). */
const WINDOW_DAYS = 3;

/** The current period for a frequency: its key, when it started, and how long it covers. */
export function currentPeriod(freq: Exclude<Frequency, "OFF">, now: Date) {
  if (freq === "WEEKLY") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SEND_HOUR));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back to Sunday
    if (d > now) d.setUTCDate(d.getUTCDate() - 7);
    return { key: `W${d.toISOString().slice(0, 10)}`, start: d, days: 7, label: "week" as const };
  }
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, SEND_HOUR));
  if (d > now) d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, SEND_HOUR));
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, SEND_HOUR));
  return { key: `M${d.toISOString().slice(0, 7)}`, start: d, days: Math.round((d.getTime() - prev.getTime()) / DAY), label: "month" as const };
}

const sum = (rows: { minutes: number; questionsAnswered: number; questionsCorrect: number }[]) =>
  rows.reduce((a, r) => ({ minutes: a.minutes + r.minutes, answered: a.answered + r.questionsAnswered, correct: a.correct + r.questionsCorrect }), { minutes: 0, answered: 0, correct: 0 });

/** The numbers for one student over the period ending `now` (and the one before, for the trend). */
export async function progressReport(studentId: string, programId: string, period: { days: number; label: "week" | "month" }, now = new Date()): Promise<GuardianProgress> {
  const since = new Date(now.getTime() - period.days * DAY);
  const before = new Date(now.getTime() - 2 * period.days * DAY);
  const [days, scores, profile, program, stats] = await Promise.all([
    db.studyDay.findMany({ where: { userId: studentId, day: { gte: before.toISOString().slice(0, 10) } }, select: { day: true, minutes: true, questionsAnswered: true, questionsCorrect: true } }),
    db.scoreRecord.findMany({ where: { studentId }, orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }], select: { takenOn: true, total: true, source: true } }),
    db.studentProfile.findUnique({ where: { userId: studentId }, select: { testDate: true } }),
    db.program.findUnique({ where: { id: programId }, select: { testDates: true } }),
    skillStats([studentId], now, 30),
  ]);
  const cut = since.toISOString().slice(0, 10);
  const cur = sum(days.filter((d) => d.day >= cut));
  const prev = sum(days.filter((d) => d.day < cut));
  const latest = scores.at(-1);
  const est = projectScore(scores.map((s) => ({ takenOn: s.takenOn, total: s.total, source: s.source })), null, now);
  const weakest = weakSkills(stats.get(studentId) ?? [])[0];
  const skill = weakest ? await db.skill.findUnique({ where: { id: weakest.skillId }, select: { name: true } }) : null;
  const test = profile?.testDate && profile.testDate > now ? profile.testDate : (program?.testDates.find((d) => d > now) ?? null);
  return {
    period: period.label,
    minutes: cur.minutes,
    answered: cur.answered,
    accuracy: cur.answered ? cur.correct / cur.answered : null,
    previousAccuracy: prev.answered ? prev.correct / prev.answered : null,
    latestScore: latest ? { total: latest.total, label: SOURCE_LABEL[latest.source as ScoreSource] ?? "score" } : null,
    estimate: est ? { low: est.low, high: est.high } : null,
    focus: skill?.name ?? null,
    testDate: test ? formatInZone(test, "UTC", "medium") : null,
  };
}

/** The first program (by class join date) with emails on that the student is in, and its frequency. */
async function programFor(studentId: string) {
  const m = await db.classMember.findFirst({
    where: { userId: studentId, class: { archivedAt: null, program: { guardianFrequency: { not: "OFF" } } } },
    orderBy: { joinedAt: "asc" },
    select: { class: { select: { program: { select: { id: true, name: true, guardianFrequency: true } } } } },
  });
  return m?.class.program ?? null;
}

/** Hourly from the worker: send this period's emails that haven't gone yet, up to the hourly cap. */
export async function sendGuardianProgress(now = new Date(), opts: { limit?: number } = {}) {
  const limit = opts.limit ?? env.GUARDIAN_EMAILS_PER_HOUR;
  const guardians = await db.guardianContact.findMany({
    where: { unsubscribedAt: null, student: { classMemberships: { some: { class: { archivedAt: null, program: { guardianFrequency: { not: "OFF" } } } } } } },
    orderBy: { createdAt: "asc" },
    include: { student: { select: { id: true, name: true } } },
  });
  let sent = 0;
  for (const g of guardians) {
    if (sent >= limit) break;
    const p = await programFor(g.studentId);
    if (!p) continue;
    const period = currentPeriod(p.guardianFrequency as "WEEKLY" | "MONTHLY", now);
    if (g.lastSentOn === period.key || now.getTime() - period.start.getTime() > WINDOW_DAYS * DAY) continue;
    // Claim it first, so two workers (or a retried hour) never send it twice.
    const claimed = await db.guardianContact.updateMany({ where: { id: g.id, OR: [{ lastSentOn: null }, { lastSentOn: { not: period.key } }] }, data: { lastSentOn: period.key } });
    if (!claimed.count) continue;
    const report = await progressReport(g.studentId, p.id, period, now);
    await sendEmail(guardianProgressMessage({ to: g.email, guardianName: g.name, studentName: g.student.name || "Your student", programName: p.name, report, unsubscribeUrl: `${env.APP_URL}/unsubscribe/${g.unsubToken}` })).catch((err) =>
      console.warn("[guardian] progress email not sent:", err instanceof Error ? err.message : err),
    );
    sent++;
  }
  return sent;
}

/** Staff preview of a student's next email (to their first guardian, or a sample address). Staff who can see the student. */
export async function previewGuardianEmail(userId: string, classId: string, studentId: string, now = new Date()) {
  const access = await classAccess(userId, classId);
  if (!(await studentInScope(access, studentId))) throw new NotFoundError("Student not found");
  const [student, program, guardian] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: studentId }, select: { name: true } }),
    db.program.findUniqueOrThrow({ where: { id: access.programId }, select: { id: true, name: true, guardianFrequency: true } }),
    db.guardianContact.findFirst({ where: { studentId }, orderBy: { createdAt: "asc" }, select: { name: true, email: true } }),
  ]);
  const freq = program.guardianFrequency === "MONTHLY" ? "MONTHLY" : "WEEKLY";
  const period = currentPeriod(freq, now);
  const report = await progressReport(studentId, program.id, period, now);
  const message = guardianProgressMessage({ to: guardian?.email ?? "guardian@example.com", guardianName: guardian?.name ?? "(guardian's name)", studentName: student.name || "Your student", programName: program.name, report, unsubscribeUrl: `${env.APP_URL}/unsubscribe/(their-own-link)` });
  return { message, frequency: program.guardianFrequency as Frequency, hasGuardian: Boolean(guardian), studentName: student.name };
}

/** The program admin turns parent progress emails off, weekly or monthly. */
export async function setGuardianFrequency(userId: string, programId: string, frequency: Frequency) {
  if (!["OFF", "WEEKLY", "MONTHLY"].includes(frequency)) throw new ClassError("Choose off, weekly or monthly.");
  const p = await db.program.findFirst({ where: { id: programId, adminId: userId }, select: { id: true, name: true } });
  if (!p) throw new NotFoundError("Program not found");
  await db.$transaction(async (tx) => {
    await tx.program.update({ where: { id: p.id }, data: { guardianFrequency: frequency } });
    await audit(tx, { programId: p.id, actorId: userId, action: "program.guardian-emails", targetType: "program", targetId: p.id, summary: `Parent progress emails: ${frequency.toLowerCase()}` });
  });
}
