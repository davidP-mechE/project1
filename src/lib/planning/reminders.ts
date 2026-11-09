import { localDay, localHour } from "./dates";

/**
 * Whether to send a student their daily reminder now. Pure and unit-tested.
 * Checked every 15 minutes by the worker; sends once, in the student's
 * chosen local hour, only if they haven't met today's goal yet.
 */
export function shouldRemind(
  user: { reminderEmails: boolean; reminderHour: number; timezone: string; lastReminderOn: string | null; emailVerified: boolean },
  todayMinutes: number,
  goalMinutes: number,
  now: Date,
): boolean {
  if (!user.reminderEmails || !user.emailVerified) return false;
  if (localHour(now, user.timezone) !== user.reminderHour) return false;
  if (user.lastReminderOn === localDay(now, user.timezone)) return false;
  return todayMinutes < goalMinutes;
}
