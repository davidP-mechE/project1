/**
 * Mastery: how well a student knows each lesson, from their practice answers
 * and flashcard memory, plus how to pick a practice set that moves it up.
 * Pure functions, so the rules are easy to test and tune.
 *
 *   New       nothing answered or reviewed yet
 *   Learning  under 40%
 *   Familiar  40–79%, or higher with questions still unanswered
 *   Mastered  80%+ and every question answered
 */

export type MasteryLevel = "new" | "learning" | "familiar" | "mastered";

export type QuestionProgress = { id: string; latestScore: number | null; lastAnsweredAt: Date | null; attempts: number };
export type CardProgress = { state: "NEW" | "LEARNING" | "REVIEW" | "RELEARNING"; stability: number };

/** A flashcard counts as fully remembered once its memory lasts about three weeks. */
export const MASTERED_STABILITY_DAYS = 21;
export const MASTERED_SCORE = 0.8;

export type LessonMastery = { score: number; level: MasteryLevel; answered: number; questions: number; cards: number };

export function lessonMastery(questions: QuestionProgress[], cards: CardProgress[]): LessonMastery {
  const answered = questions.filter((q) => q.latestScore !== null).length;
  const reviewed = cards.filter((c) => c.state !== "NEW").length;
  const qScore = questions.length ? questions.reduce((n, q) => n + (q.latestScore ?? 0), 0) / questions.length : null;
  const cScore = cards.length ? cards.reduce((n, c) => n + (c.state === "NEW" ? 0 : Math.min(1, c.stability / MASTERED_STABILITY_DAYS)), 0) / cards.length : null;
  const score = qScore !== null && cScore !== null ? 0.7 * qScore + 0.3 * cScore : (qScore ?? cScore ?? 0);
  let level: MasteryLevel;
  if (answered === 0 && reviewed === 0) level = "new";
  else if (score < 0.4) level = "learning";
  else if (score < MASTERED_SCORE || answered < questions.length) level = "familiar";
  else level = "mastered";
  return { score: Math.round(score * 100) / 100, level, answered, questions: questions.length, cards: cards.length };
}

export const LEVEL_LABEL: Record<MasteryLevel, string> = { new: "New", learning: "Learning", familiar: "Familiar", mastered: "Mastered" };

/** The course's overall mastery: the average over lessons that have something to practise. */
export function courseMastery(lessons: LessonMastery[]): { score: number; counts: Record<MasteryLevel, number> } {
  const counts: Record<MasteryLevel, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  for (const l of lessons) counts[l.level]++;
  const scored = lessons.filter((l) => l.questions + l.cards > 0);
  const score = scored.length ? scored.reduce((n, l) => n + l.score, 0) / scored.length : 0;
  return { score: Math.round(score * 100) / 100, counts };
}

export type Candidate = QuestionProgress & { lessonId: string; lessonScore: number };

/**
 * Picks a practice set: first questions never answered or last answered
 * wrong (weakest lessons first), then the ones answered right longest ago
 * (a spaced refresher). At most `perLesson` from one lesson when practising
 * across the course, so a set covers several lessons.
 */
export function pickPracticeSet(candidates: Candidate[], size: number, opts: { perLesson?: number; now?: Date } = {}): string[] {
  const now = opts.now ?? new Date();
  const priority = (c: Candidate) => {
    if (c.latestScore === null) return 0 + c.lessonScore; // not tried yet
    if (c.latestScore < MASTERED_SCORE) return 1 + c.latestScore * 0.5 + c.lessonScore * 0.5; // got it wrong last time
    const days = c.lastAnsweredAt ? (now.getTime() - c.lastAnsweredAt.getTime()) / 86_400_000 : 0;
    return 3 - Math.min(1, days / 30); // right last time: oldest first
  };
  const sorted = [...candidates].sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
  const perLesson = opts.perLesson ?? Infinity;
  const taken = new Map<string, number>();
  const out: string[] = [];
  for (const c of sorted) {
    if (out.length >= size) break;
    const n = taken.get(c.lessonId) ?? 0;
    if (n >= perLesson) continue;
    taken.set(c.lessonId, n + 1);
    out.push(c.id);
  }
  // If the per-lesson cap left the set short, fill it from what's left.
  for (const c of sorted) {
    if (out.length >= size) break;
    if (!out.includes(c.id)) out.push(c.id);
  }
  return out;
}

/**
 * The order of a practice session: a question answered wrong comes back a few
 * questions later (at most twice), so the set ends with every idea answered right.
 */
export function requeue(queue: string[], current: string, correct: boolean, retries: Map<string, number>, gap = 3, maxRetries = 2): string[] {
  const rest = queue.slice(1);
  if (correct) return rest;
  const n = retries.get(current) ?? 0;
  if (n >= maxRetries) return rest;
  retries.set(current, n + 1);
  const at = Math.min(rest.length, gap);
  return [...rest.slice(0, at), current, ...rest.slice(at)];
}
