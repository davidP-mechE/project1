/**
 * XP, levels and daily quests: a little game layer on top of the activity
 * already counted each day (StudyDay). Nothing extra is stored, so XP can't
 * drift from what the student actually did, and the rules can change freely.
 */

export const XP = {
  question: 2, // answering a practice or test question
  correctBonus: 1, // extra for getting it right
  card: 1, // reviewing a flashcard
  lesson: 10, // completing a lesson
  minute: 1, // each studied minute (heartbeat)
  quest: 20, // each daily quest completed
} as const;

export type DayActivity = {
  day: string; // local date, YYYY-MM-DD
  minutes: number;
  cardsReviewed: number;
  questionsAnswered: number;
  questionsCorrect: number;
  lessonsCompleted: number;
};

type QuestDef = { id: string; label: string; target: number; progress: (d: DayActivity, goalMinutes: number) => number; targetFor?: (goalMinutes: number) => number };

const QUESTS: QuestDef[] = [
  { id: "answer", label: "Answer 15 practice questions", target: 15, progress: (d) => d.questionsAnswered },
  { id: "correct", label: "Get 10 questions right", target: 10, progress: (d) => d.questionsCorrect },
  { id: "cards", label: "Review 20 flashcards", target: 20, progress: (d) => d.cardsReviewed },
  { id: "lesson", label: "Finish a lesson", target: 1, progress: (d) => d.lessonsCompleted },
  { id: "minutes", label: "Study for your daily goal", target: 20, progress: (d) => d.minutes, targetFor: (g) => g },
];

export type Quest = { id: string; label: string; target: number; progress: number; done: boolean; xp: number };

/** A small, stable hash of the date, so each day has its own three quests (the same on every device). */
function dayHash(day: string) {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Today's three quests: always "Finish a lesson" or "Study for your goal", plus two of the others. */
export function questsFor(day: string, activity: DayActivity | null, goalMinutes = 20): Quest[] {
  const h = dayHash(day);
  const anchor = QUESTS.filter((q) => q.id === "lesson" || q.id === "minutes")[h % 2];
  const others = QUESTS.filter((q) => q !== anchor && q.id !== "lesson" && q.id !== "minutes");
  const first = others[(h >>> 3) % others.length];
  const rest = others.filter((q) => q !== first);
  const second = rest[(h >>> 7) % rest.length];
  return [first, second, anchor].map((q) => {
    const target = q.targetFor ? Math.max(1, q.targetFor(goalMinutes)) : q.target;
    const progress = activity ? Math.min(target, q.progress(activity, goalMinutes)) : 0;
    return { id: q.id, label: q.id === "minutes" ? `Study for ${target} minutes` : q.label, target, progress, done: progress >= target, xp: XP.quest };
  });
}

export function xpForDay(d: DayActivity, goalMinutes = 20): number {
  const base =
    d.questionsAnswered * XP.question + d.questionsCorrect * XP.correctBonus + d.cardsReviewed * XP.card + d.lessonsCompleted * XP.lesson + d.minutes * XP.minute;
  const quests = questsFor(d.day, d, goalMinutes).filter((q) => q.done).length * XP.quest;
  return base + quests;
}

export function totalXp(days: DayActivity[], goalMinutes = 20): number {
  return days.reduce((n, d) => n + xpForDay(d, goalMinutes), 0);
}

/**
 * Levels get gradually longer: level 2 at 100 XP, 3 at 250, 4 at 450, …
 * (each level needs 50 XP more than the one before).
 */
export function levelFor(xp: number): { level: number; intoLevel: number; levelSize: number } {
  let level = 1;
  let start = 0;
  let size = 100;
  while (xp >= start + size) {
    start += size;
    size += 50;
    level++;
  }
  return { level, intoLevel: xp - start, levelSize: size };
}
