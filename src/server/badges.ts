import "server-only";
import { db } from "./db";
import { getGameSummary } from "./gamification";
import { myScores } from "./scores";
import { domainTally } from "./pacing";
import { NotFoundError } from "./courses";
import { classAccess, studentInScope } from "./access";
import { domainName } from "@/lib/sat/domains";

/**
 * Simple badges for steady work. They're awarded when the student's activity
 * is checked (opening Today, and hourly for active students), shown to the
 * student, and to staff whose scope includes them. Nothing here compares
 * students with each other: there are no leaderboards.
 */

export type BadgeKind = "STREAK_5" | "STREAK_10" | "STREAK_30" | "MISTAKES_CLEARED" | "DOMAIN_MASTERED" | "FIRST_DIAGNOSTIC" | "GAIN_100" | "GAIN_200" | "PERFECT_ATTENDANCE";

export const BADGE_INFO: Record<BadgeKind, { label: string; how: string }> = {
  STREAK_5: { label: "5-day streak", how: "Practice 5 days in a row." },
  STREAK_10: { label: "10-day streak", how: "Practice 10 days in a row." },
  STREAK_30: { label: "30-day streak", how: "Practice 30 days in a row." },
  MISTAKES_CLEARED: { label: "Mistake log cleared", how: "Get every question in your mistake log right twice." },
  DOMAIN_MASTERED: { label: "Domain mastered", how: "85% or better on 20+ questions in one area over 30 days." },
  FIRST_DIAGNOSTIC: { label: "First diagnostic", how: "Finish your first diagnostic." },
  GAIN_100: { label: "+100 points", how: "Score 100 points above your baseline." },
  GAIN_200: { label: "+200 points", how: "Score 200 points above your baseline." },
  PERFECT_ATTENDANCE: { label: "Perfect attendance", how: "Present at every session in a month (at least 4)." },
};

const MASTERY = { minAnswers: 20, minAccuracy: 0.85, days: 30 };

/** Badges this student has just earned (if any), saved. Safe to call often. */
export async function awardBadges(userId: string, now = new Date()) {
  const earned: { kind: BadgeKind; detail: string }[] = [];
  const [game, scores, tally, mistakes, diagnostic, attendance] = await Promise.all([
    getGameSummary(userId),
    myScores(userId, now),
    domainTally(userId, MASTERY.days, now),
    db.mistakeItem.groupBy({ by: ["retiredAt"], where: { studentId: userId }, _count: true }).then((rows) => ({ total: rows.reduce((s, r) => s + r._count, 0), open: rows.filter((r) => r.retiredAt === null).reduce((s, r) => s + r._count, 0) })),
    db.diagnosticAttempt.count({ where: { userId, finishedAt: { not: null } } }),
    db.attendanceRecord.findMany({ where: { studentId: userId }, select: { status: true, session: { select: { startsAt: true } } } }),
  ]);
  for (const [n, kind] of [[5, "STREAK_5"], [10, "STREAK_10"], [30, "STREAK_30"]] as const) if (game.streak >= n) earned.push({ kind, detail: "" });
  if (mistakes.total > 0 && mistakes.open === 0) earned.push({ kind: "MISTAKES_CLEARED", detail: "" });
  for (const [domain, t] of tally) if (t.n >= MASTERY.minAnswers && t.sum / t.n >= MASTERY.minAccuracy) earned.push({ kind: "DOMAIN_MASTERED", detail: domain });
  if (diagnostic > 0) earned.push({ kind: "FIRST_DIAGNOSTIC", detail: "" });
  const gain = scores.baseline && scores.latest ? scores.latest.total - scores.baseline.total : 0;
  if (gain >= 100) earned.push({ kind: "GAIN_100", detail: "" });
  if (gain >= 200) earned.push({ kind: "GAIN_200", detail: "" });
  // Perfect attendance: finished months only (UTC months), every session present, at least 4.
  const thisMonth = now.toISOString().slice(0, 7);
  const months = new Map<string, { n: number; present: number }>();
  for (const r of attendance) {
    const m = r.session.startsAt.toISOString().slice(0, 7);
    if (m >= thisMonth) continue;
    const t = months.get(m) ?? { n: 0, present: 0 };
    t.n += 1;
    if (r.status === "PRESENT") t.present += 1;
    months.set(m, t);
  }
  for (const [m, t] of months) if (t.n >= 4 && t.present === t.n) earned.push({ kind: "PERFECT_ATTENDANCE", detail: m });

  if (!earned.length) return [];
  const before = await db.badge.findMany({ where: { userId }, select: { kind: true, detail: true } });
  const have = new Set(before.map((b) => `${b.kind}:${b.detail}`));
  const fresh = earned.filter((e) => !have.has(`${e.kind}:${e.detail}`));
  if (fresh.length) await db.badge.createMany({ data: fresh.map((e) => ({ userId, ...e, earnedAt: now })), skipDuplicates: true });
  return fresh;
}

const label = (b: { kind: string; detail: string }) => {
  const info = BADGE_INFO[b.kind as BadgeKind];
  if (!info) return b.kind;
  if (b.kind === "DOMAIN_MASTERED" && b.detail) return `${domainName(b.detail)} mastered`;
  if (b.kind === "PERFECT_ATTENDANCE" && b.detail) return `Perfect attendance, ${new Date(`${b.detail}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  return info.label;
};

/** A student's own badges, newest first. */
export async function myBadges(userId: string) {
  const rows = await db.badge.findMany({ where: { userId }, orderBy: { earnedAt: "desc" }, select: { id: true, kind: true, detail: true, earnedAt: true } });
  return rows.map((b) => ({ ...b, label: label(b), how: BADGE_INFO[b.kind as BadgeKind]?.how ?? "" }));
}

/** A student's badges for staff: only if the student is in the viewer's scope. */
export async function studentBadges(viewerId: string, classId: string, studentId: string) {
  const a = await classAccess(viewerId, classId, "view");
  if (!(await studentInScope(a, studentId))) throw new NotFoundError("Student not found");
  return myBadges(studentId);
}

/** Hourly: check students who did anything in the last two days. */
export async function awardBadgesForActive(now = new Date()) {
  const since = new Date(now.getTime() - 2 * 86_400_000);
  const rows = await db.classMember.findMany({ where: { class: { archivedAt: null }, user: { lastLoginAt: { gte: since } } }, distinct: ["userId"], select: { userId: true } });
  let n = 0;
  for (const r of rows) n += (await awardBadges(r.userId, now).catch(() => [])).length;
  return n;
}
