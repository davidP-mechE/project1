/**
 * Weak topics: ideas the student keeps getting wrong. Pure and unit-tested.
 *
 * Each practice answer has a topic (e.g. "Ohm's law") and a score 0–1. Recent
 * answers count more (a 14-day half-life), and the average is pulled toward a
 * neutral prior so one wrong answer doesn't brand a topic "weak". A topic is
 * weak when its adjusted score is below 0.6 with at least 2 answers.
 */

export type AttemptLike = { topic: string; lessonId: string | null; score: number; createdAt: Date };
export type TopicScore = { topic: string; lessonId: string | null; score: number; attempts: number; lastAt: Date };

export const HALF_LIFE_DAYS = 14;
export const PRIOR_WEIGHT = 1;
export const PRIOR_SCORE = 0.7;
export const WEAK_BELOW = 0.6;
export const MIN_ATTEMPTS = 2;

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

export function topicScores(attempts: AttemptLike[], now: Date): TopicScore[] {
  const groups = new Map<string, AttemptLike[]>();
  for (const a of attempts) {
    if (!a.topic.trim()) continue;
    const k = norm(a.topic);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.values()].map((list) => {
    let w = 0;
    let sum = 0;
    for (const a of list) {
      const ageDays = Math.max(0, (now.getTime() - a.createdAt.getTime()) / 86_400_000);
      const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      w += weight;
      sum += weight * Math.min(1, Math.max(0, a.score));
    }
    const latest = list.reduce((x, y) => (y.createdAt > x.createdAt ? y : x));
    return {
      topic: latest.topic.trim(),
      lessonId: latest.lessonId,
      score: (sum + PRIOR_WEIGHT * PRIOR_SCORE) / (w + PRIOR_WEIGHT),
      attempts: list.length,
      lastAt: latest.createdAt,
    };
  });
}

/** The weakest topics first. */
export function weakTopics(attempts: AttemptLike[], now: Date, limit = 6): TopicScore[] {
  return topicScores(attempts, now)
    .filter((t) => t.attempts >= MIN_ATTEMPTS && t.score < WEAK_BELOW)
    .sort((a, b) => a.score - b.score || b.attempts - a.attempts)
    .slice(0, limit);
}
