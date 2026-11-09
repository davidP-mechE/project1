import "server-only";
import { db } from "./db";

export class PreferencesError extends Error {}

export async function getPreferences(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { dailyGoalMinutes: true, newCardsPerDay: true, reminderEmails: true, reminderHour: true, timezone: true },
  });
}

export async function savePreferences(userId: string, input: { dailyGoalMinutes?: unknown; newCardsPerDay?: unknown; reminderEmails?: unknown; reminderHour?: unknown; timezone?: unknown }) {
  const int = (v: unknown, min: number, max: number, label: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new PreferencesError(`${label} must be between ${min} and ${max}.`);
    return n;
  };
  const data = {
    dailyGoalMinutes: int(input.dailyGoalMinutes, 5, 240, "Daily goal"),
    newCardsPerDay: int(input.newCardsPerDay, 0, 200, "New cards per day"),
    reminderEmails: input.reminderEmails === true,
    reminderHour: int(input.reminderHour, 0, 23, "Reminder hour"),
    timezone: "UTC",
  };
  const tz = typeof input.timezone === "string" ? input.timezone : "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    data.timezone = tz;
  } catch {
    throw new PreferencesError("Unknown time zone.");
  }
  await db.user.update({ where: { id: userId }, data });
}
