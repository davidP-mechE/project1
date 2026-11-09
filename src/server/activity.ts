import "server-only";
import { db } from "./db";
import { localDay } from "@/lib/planning/dates";

/**
 * Daily activity (StudyDay rows, one per student per local day).
 * Counts are bumped as things happen; minutes come from a heartbeat sent once
 * a minute while a study page is open and being used.
 */

type Counter = "cardsReviewed" | "questionsAnswered" | "questionsCorrect" | "lessonsCompleted";

async function today(userId: string, now: Date) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return localDay(now, u?.timezone ?? "UTC");
}

/** Add to today's counters: bumpActivity(id, "cardsReviewed") or bumpActivity(id, { questionsAnswered: 3, questionsCorrect: 2 }). */
export async function bumpActivity(userId: string, field: Counter | Partial<Record<Counter, number>>, now = new Date()) {
  const counts = typeof field === "string" ? { [field]: 1 } : Object.fromEntries(Object.entries(field).filter(([, n]) => n && n > 0));
  if (Object.keys(counts).length === 0) return;
  const day = await today(userId, now);
  await db.studyDay.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, ...counts },
    update: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, { increment: n }])),
  });
}

/** Add a studied minute. Ignored if less than 50 s since the last one (several open tabs count once). */
export async function recordStudyMinute(userId: string, now = new Date()) {
  const day = await today(userId, now);
  const cutoff = new Date(now.getTime() - 50_000);
  const updated = await db.studyDay.updateMany({
    where: { userId, day, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: cutoff } }] },
    data: { minutes: { increment: 1 }, lastActiveAt: now },
  });
  if (updated.count > 0) return true;
  const exists = await db.studyDay.findUnique({ where: { userId_day: { userId, day } }, select: { id: true } });
  if (exists) return false; // counted less than 50 s ago
  try {
    await db.studyDay.create({ data: { userId, day, minutes: 1, lastActiveAt: now } });
    return true;
  } catch {
    return false; // another tab created it at the same moment
  }
}
