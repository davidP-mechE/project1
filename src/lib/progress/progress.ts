/**
 * Course progress: how much is done, and where to pick up again.
 * Pure functions over the course's included lessons, in course order.
 */

export type ProgressLesson = {
  id: string;
  unitId: string;
  ready: boolean; // has content the student can study
  completedAt: Date | null;
  lastViewedAt: Date | null;
};

export function percentComplete(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/** Overall and per-unit completion. Skipped lessons are not passed in, so they don't count. */
export function courseProgress(lessons: ProgressLesson[]) {
  const done = lessons.filter((l) => l.completedAt).length;
  const units = new Map<string, { done: number; total: number }>();
  for (const l of lessons) {
    const u = units.get(l.unitId) ?? { done: 0, total: 0 };
    u.total += 1;
    if (l.completedAt) u.done += 1;
    units.set(l.unitId, u);
  }
  return {
    done,
    total: lessons.length,
    pct: percentComplete(done, lessons.length),
    units: new Map([...units].map(([id, u]) => [id, { ...u, pct: percentComplete(u.done, u.total) }])),
  };
}

/**
 * Which lesson "Continue" should open:
 * 1. the lesson viewed most recently, if it isn't finished;
 * 2. otherwise the first unfinished, ready lesson after it;
 * 3. otherwise the first unfinished, ready lesson anywhere.
 * Null when everything ready is finished (or nothing is ready yet).
 */
export function resumeLesson(lessons: ProgressLesson[]): { id: string; reason: "continue" | "next" | "start" } | null {
  const viewed = lessons
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.lastViewedAt)
    .sort((a, b) => b.l.lastViewedAt!.getTime() - a.l.lastViewedAt!.getTime())[0];
  const open = (l: ProgressLesson) => l.ready && !l.completedAt;
  if (viewed) {
    if (open(viewed.l)) return { id: viewed.l.id, reason: "continue" };
    const after = lessons.slice(viewed.i + 1).find(open);
    if (after) return { id: after.id, reason: "next" };
  }
  const first = lessons.find(open);
  if (!first) return null;
  return { id: first.id, reason: viewed || lessons.some((l) => l.completedAt) ? "next" : "start" };
}
