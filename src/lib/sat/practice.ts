import { DOMAINS } from "./domains";

/**
 * SAT practice logic: grid-in answer checking, the adaptive route through a
 * diagnostic, its estimated section scores, the mistake log's review spacing,
 * and a weekly plan back from the test date. Pure functions, easy to test.
 */

/** A number a student might type for a grid-in: "3/4", ".75", "0.750", "-2", "1,000". */
export function parseGridIn(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "").replace(/\s+/g, "").replace(/^\$/, "");
  if (/^-?\d*\.?\d+$/.test(s)) return Number(s);
  const f = /^(-?\d+)\/(\d+)$/.exec(s);
  if (f && Number(f[2]) !== 0) return Number(f[1]) / Number(f[2]);
  return null;
}

/**
 * Does a grid-in response match the key? Numbers are compared by value, so
 * 3/4, .75 and 0.75 all match; a key can list several answers ("2 or -3").
 * Non-numeric keys fall back to a case-insensitive exact match.
 */
export function gridInMatches(key: string, response: string): boolean {
  const answers = key.split(/\s*(?:\bor\b|;|\|)\s*/i).map((a) => a.trim()).filter(Boolean);
  const r = parseGridIn(response);
  for (const a of answers) {
    const k = parseGridIn(a);
    if (k !== null && r !== null && Math.abs(k - r) < 1e-4 * Math.max(1, Math.abs(k))) return true;
    if (k === null && a.toLowerCase().replace(/\s+/g, " ") === response.trim().toLowerCase().replace(/\s+/g, " ")) return true;
  }
  return false;
}

export type Route = "M2_HARD" | "M2_EASY";
export const routeFor = (moduleOneCorrect: number, threshold: number): Route => (moduleOneCorrect >= threshold ? "M2_HARD" : "M2_EASY");

/** Default: route to the harder module 2 with 60% or more right in module 1. */
export const defaultThreshold = (moduleOneQuestions: number) => Math.ceil(moduleOneQuestions * 0.6);

export type Conversion = { hardMax: number; easyMax: number };
export const DEFAULT_CONVERSION: Conversion = { hardMax: 800, easyMax: 640 };

/**
 * An ESTIMATED 200–800 section score from the share of questions right across
 * both modules, scaled to the route's ceiling (the easier module 2 can't reach
 * the top scores, as on the real test). Not an official conversion.
 */
export function estimateSection(correct: number, total: number, route: Route, conversion: Conversion = DEFAULT_CONVERSION) {
  if (total <= 0) return 200;
  const max = route === "M2_HARD" ? conversion.hardMax : conversion.easyMax;
  const raw = 200 + (max - 200) * Math.min(1, Math.max(0, correct / total));
  return Math.min(800, Math.max(200, Math.round(raw / 10) * 10));
}

/** Mistake log spacing: right answers push the next review out 1, 3, 7, then 16 days; two right in a row retires it. */
export const REVIEW_DAYS = [1, 3, 7, 16];
export function nextReview(streak: number, correct: boolean, now = new Date()) {
  if (!correct) return { streak: 0, due: new Date(now.getTime() + 86_400_000), retired: false };
  const s = streak + 1;
  return { streak: s, due: new Date(now.getTime() + REVIEW_DAYS[Math.min(s, REVIEW_DAYS.length - 1)] * 86_400_000), retired: s >= 2 };
}

export type PlanWeek = { start: Date; end: Date; focus: string[]; checkpoint: boolean; finalReview: boolean; assignments: { title: string; dueAt: Date }[] };

/**
 * A weekly plan from this week to the test date: the weakest domains first
 * (two a week, cycling), a practice test every 4 weeks, the last week for
 * review, and the student's assigned work placed in its week. Rebuilt every
 * time it's shown, so it follows the newest results.
 */
export function buildPlan(input: { now: Date; testDate: Date; accuracy: Record<string, number | null>; assignments: { title: string; dueAt: Date | null }[] }): PlanWeek[] {
  const DAY = 86_400_000;
  const start = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()));
  const test = new Date(Date.UTC(input.testDate.getUTCFullYear(), input.testDate.getUTCMonth(), input.testDate.getUTCDate()));
  if (test.getTime() <= start.getTime()) return [];
  const weeks = Math.min(52, Math.ceil((test.getTime() - start.getTime() + DAY) / (7 * DAY)));
  // Weakest first; domains with no data yet go after the known-weak ones but before the strong ones.
  const order = [...DOMAINS]
    .map((d) => ({ id: d.id, acc: input.accuracy[d.id] ?? null }))
    .sort((a, b) => (a.acc ?? 0.65) - (b.acc ?? 0.65))
    .map((d) => d.id);
  const out: PlanWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const ws = new Date(start.getTime() + w * 7 * DAY);
    const we = new Date(Math.min(ws.getTime() + 6 * DAY, test.getTime()));
    const finalReview = w === weeks - 1;
    out.push({
      start: ws,
      end: we,
      focus: finalReview ? [] : [order[(2 * w) % order.length], order[(2 * w + 1) % order.length]],
      checkpoint: !finalReview && w > 0 && w % 4 === 3,
      finalReview,
      assignments: input.assignments.filter((a): a is { title: string; dueAt: Date } => Boolean(a.dueAt && a.dueAt >= ws && a.dueAt < new Date(we.getTime() + DAY))),
    });
  }
  return out;
}
