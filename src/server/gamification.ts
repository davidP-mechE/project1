import "server-only";
import { cache } from "react";
import { db } from "./db";
import { addDays, localDay } from "@/lib/planning/dates";
import { isActive, streaks } from "@/lib/planning/streaks";
import { levelFor, questsFor, totalXp } from "@/lib/gamification/xp";

/**
 * XP, level, streak and today's quests for the sidebar and the Today page.
 * Worked out from StudyDay rows (see src/lib/gamification/xp.ts). Cached per
 * request, since the layout and the page both ask.
 */
export const getGameSummary = cache(async (userId: string, now: Date = new Date()) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true, dailyGoalMinutes: true } });
  const today = localDay(now, user.timezone);
  const days = await db.studyDay.findMany({
    where: { userId },
    select: { day: true, minutes: true, cardsReviewed: true, questionsAnswered: true, questionsCorrect: true, lessonsCompleted: true },
  });
  const xp = totalXp(days, user.dailyGoalMinutes);
  const todayRow = days.find((d) => d.day === today) ?? null;
  const streak = streaks(days.filter(isActive).map((d) => d.day), today);
  const weekStart = addDays(today, -6);
  const week = days.filter((d) => d.day >= weekStart);
  return {
    xp,
    week: { answered: week.reduce((n, d) => n + d.questionsAnswered, 0), correct: week.reduce((n, d) => n + d.questionsCorrect, 0) },
    ...levelFor(xp),
    streak: streak.current,
    studiedToday: streak.studiedToday,
    quests: questsFor(today, todayRow, user.dailyGoalMinutes),
  };
});

export type GameSummary = Awaited<ReturnType<typeof getGameSummary>>;
