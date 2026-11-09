import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { sendEmail, type EmailMessage } from "./email";
import { reminderMessage } from "./email/templates";
import { getReviewCounts } from "./srs";
import { addDays, localDay } from "@/lib/planning/dates";
import { shouldRemind } from "@/lib/planning/reminders";
import { isActive, streaks } from "@/lib/planning/streaks";

/**
 * Daily study reminders. The worker calls sendDueReminders every 15 minutes;
 * each student who turned reminders on gets at most one email a day, in the
 * hour they chose, and only if they haven't reached their daily goal yet.
 */

const sign = (userId: string) => createHmac("sha256", env.BETTER_AUTH_SECRET).update(`unsubscribe:${userId}`).digest("base64url");

export function unsubscribeUrl(userId: string) {
  return `${env.APP_URL}/api/reminders/unsubscribe?u=${encodeURIComponent(userId)}&s=${sign(userId)}`;
}

/** One-click unsubscribe from the email (no login needed; the link is signed). */
export async function unsubscribe(userId: string, signature: string) {
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  await db.user.updateMany({ where: { id: userId }, data: { reminderEmails: false } });
  return true;
}

export async function sendDueReminders(now = new Date(), send: (m: EmailMessage) => Promise<void> = sendEmail) {
  const users = await db.user.findMany({
    where: { reminderEmails: true, emailVerified: true },
    select: { id: true, name: true, email: true, timezone: true, reminderEmails: true, reminderHour: true, lastReminderOn: true, emailVerified: true, dailyGoalMinutes: true },
  });
  let sent = 0;
  for (const u of users) {
    const today = localDay(now, u.timezone);
    const days = await db.studyDay.findMany({ where: { userId: u.id, day: { gte: addDays(today, -60) } } });
    const todayMinutes = days.find((d) => d.day === today)?.minutes ?? 0;
    if (!shouldRemind(u, todayMinutes, u.dailyGoalMinutes, now)) continue;
    // Claim today's reminder first, so two workers can never both send it.
    const claimed = await db.user.updateMany({ where: { id: u.id, OR: [{ lastReminderOn: null }, { lastReminderOn: { not: today } }] }, data: { lastReminderOn: today } });
    if (claimed.count === 0) continue;
    const streak = streaks(days.filter(isActive).map((d) => d.day), today);
    const [review, planToday] = await Promise.all([
      getReviewCounts(u.id, now),
      db.planItem.count({ where: { plan: { userId: u.id }, kind: "LESSON", day: { lte: today }, lesson: { progress: { none: { userId: u.id, completedAt: { not: null } } } } } }),
    ]);
    try {
      await send(
        reminderMessage({
          to: u.email,
          name: u.name,
          minutesToday: todayMinutes,
          goal: u.dailyGoalMinutes,
          cardsDue: review.due + review.new,
          planLessons: planToday,
          streak: streak.current,
          studiedToday: streak.studiedToday,
          appUrl: env.APP_URL,
          unsubscribeUrl: unsubscribeUrl(u.id),
        }),
      );
      sent++;
    } catch (err) {
      console.error(`[reminders] couldn't email ${u.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
