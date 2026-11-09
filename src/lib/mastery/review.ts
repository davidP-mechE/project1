/**
 * Spaced repetition for practice questions, skills (by topic) and the error
 * log: pure functions over a student's answer history, so nothing extra has to
 * be stored and the rules are easy to test.
 */

export type Attempt = { correct: boolean; score: number; at: Date };

/** Days until a question comes back, by how many times in a row it was answered right. */
export const QUESTION_INTERVALS = [1, 3, 7, 16, 35, 75, 160];

/**
 * When a question is next due: a miss comes back the next day; each right
 * answer in a row pushes it further out (1, 3, 7, 16… days).
 */
export function questionSchedule(attempts: Attempt[]): { streak: number; due: Date | null; lastAt: Date | null } {
  if (attempts.length === 0) return { streak: 0, due: null, lastAt: null };
  const sorted = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime());
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].correct; i--) streak++;
  const last = sorted[sorted.length - 1].at;
  const days = streak === 0 ? QUESTION_INTERVALS[0] : QUESTION_INTERVALS[Math.min(streak, QUESTION_INTERVALS.length) - 1];
  return { streak, due: new Date(last.getTime() + days * 86_400_000), lastAt: last };
}

export const isDue = (schedule: { due: Date | null }, now: Date) => schedule.due !== null && schedule.due.getTime() <= now.getTime();

/** "Ohm’s Law " and "ohm's law" are the same skill. */
export function skillKey(topic: string): string {
  return topic.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
}

/** Right answers in a row needed to call a skill "hammered" (in a Review session, and from history). */
export const HAMMER_STREAK = 5;

export type SkillStats = {
  attempts: number;
  correct: number;
  accuracy: number | null; // 0–1
  recentStreak: number; // right answers in a row, most recent first
  lastAt: Date | null;
  status: "new" | "shaky" | "improving" | "hammered";
};

/** How a student is doing on one skill, from every answer to its questions. */
export function skillStats(attempts: Attempt[]): SkillStats {
  if (attempts.length === 0) return { attempts: 0, correct: 0, accuracy: null, recentStreak: 0, lastAt: null, status: "new" };
  const sorted = [...attempts].sort((a, b) => b.at.getTime() - a.at.getTime());
  const correct = sorted.filter((a) => a.correct).length;
  let recentStreak = 0;
  for (const a of sorted) {
    if (!a.correct) break;
    recentStreak++;
  }
  // Accuracy over the last 20 answers, so old mistakes fade.
  const recent = sorted.slice(0, 20);
  const accuracy = recent.reduce((n, a) => n + a.score, 0) / recent.length;
  const status = recentStreak >= HAMMER_STREAK || (accuracy >= 0.9 && recent.length >= 8) ? "hammered" : accuracy >= 0.6 ? "improving" : "shaky";
  return { attempts: attempts.length, correct, accuracy, recentStreak, lastAt: sorted[0].at, status };
}

export const SKILL_STATUS_LABEL: Record<SkillStats["status"], string> = { new: "Not tried", shaky: "Shaky", improving: "Improving", hammered: "Hammered" };
