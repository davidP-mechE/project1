import { z } from "zod";
import { DOMAINS, isDomain } from "./domains";

/**
 * SAT score records: checks, projections and program statistics. Pure
 * functions, so they're easy to test. Official tests are supported for score
 * entry only: totals, section scores, and which question numbers were missed
 * (with their domain), never question content.
 */

export const SCORE_SOURCES = ["DIAGNOSTIC", "PSAT", "SAT", "PRACTICE_BLUEBOOK", "PRACTICE_OTHER"] as const;
export type ScoreSource = (typeof SCORE_SOURCES)[number];
export const SOURCE_LABEL: Record<ScoreSource, string> = {
  DIAGNOSTIC: "Our diagnostic",
  PSAT: "PSAT",
  SAT: "SAT",
  PRACTICE_BLUEBOOK: "Bluebook practice test",
  PRACTICE_OTHER: "Other practice test",
};
export const MISS_REASONS = ["CARELESS", "CONCEPT", "TIME", "GUESS"] as const;
export const REASON_LABEL: Record<(typeof MISS_REASONS)[number], string> = { CARELESS: "Careless", CONCEPT: "Didn't know how", TIME: "Ran out of time", GUESS: "Guessed" };

/** One missed question on an outside test: its number and topic only. No content fields exist. */
export const MissedSchema = z
  .object({
    section: z.enum(["MATH", "RW"]),
    module: z.union([z.literal(1), z.literal(2)]),
    number: z.number().int().min(1).max(30),
    domain: z.string().refine(isDomain, "Unknown domain"),
    skill: z.string().max(120).optional(),
    reason: z.enum(MISS_REASONS).optional(),
  })
  .strict()
  .refine((m) => DOMAINS.find((d) => d.id === m.domain)!.section === m.section, "The domain must be in that section")
  .refine((m) => !m.skill || DOMAINS.find((d) => d.id === m.domain)!.skills.includes(m.skill), "Unknown skill");
export type Missed = z.infer<typeof MissedSchema>;

/** One question from a College Board review: numbers, labels and right/wrong only. */
export const ReviewQuestionSchema = z
  .object({
    section: z.enum(["MATH", "RW"]),
    module: z.union([z.literal(1), z.literal(2)]),
    number: z.number().int().min(1).max(30),
    domain: z.string().refine(isDomain, "Unknown domain"),
    skill: z.string().max(120).nullable(),
    correct: z.boolean(),
  })
  .strict()
  .refine((m) => DOMAINS.find((d) => d.id === m.domain)!.section === m.section, "The domain must be in that section");

/** Knowledge and Skills bands (1–7) per domain, from a College Board score report. */
export const DomainBandsSchema = z.record(z.string().refine(isDomain, "Unknown domain"), z.number().int().min(1).max(7));

const scaled = (min: number, max: number) => z.number().int().min(min).max(max).refine((n) => n % 10 === 0, "Scores go up in steps of 10");

/** A score as entered. `.strict()` refuses any field that isn't listed, so question text can't be sent. */
export const ScoreInputSchema = z
  .object({
    source: z.enum(SCORE_SOURCES),
    takenOn: z.coerce.date(),
    testName: z.string().trim().max(120).optional(),
    total: scaled(400, 1600),
    rw: scaled(200, 800).nullable().optional(),
    math: scaled(200, 800).nullable().optional(),
    isBaseline: z.boolean().optional(),
    missed: z.array(MissedSchema).max(98).optional(),
    domainBands: DomainBandsSchema.optional(),
    review: z.array(ReviewQuestionSchema).max(120).optional(),
  })
  .strict()
  .refine((s) => s.rw == null || s.math == null || s.rw + s.math === s.total, { message: "The two section scores must add up to the total.", path: ["total"] });
export type ScoreInput = z.infer<typeof ScoreInputSchema>;

export function checkTakenOn(d: Date, now = new Date()) {
  if (d.getTime() > now.getTime() + 86_400_000) return "The test date can't be in the future.";
  if (d.getFullYear() < 2015) return "That date is too long ago.";
  return null;
}

export type ScorePoint = { takenOn: Date; total: number; source: string };

const round10 = (n: number) => Math.round(n / 10) * 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const WEEK = 7 * 86_400_000;

/**
 * An estimated current score range from the student's recent scores and their
 * practice accuracy since the latest one. NOT an official conversion: it's a
 * trend line, shown as a range and labelled "estimate".
 *  - centre: the latest score, plus the recent trend (points per week over the
 *    last 4 scores) for the weeks since then, capped at ±60
 *  - practice since: ≥75% on 20+ answers adds 10; under 50% takes 10
 *  - width: ±40 with 3+ scores, ±60 otherwise
 */
export function projectScore(points: ScorePoint[], practice: { answered: number; accuracy: number } | null, now = new Date()) {
  const sorted = [...points].sort((a, b) => a.takenOn.getTime() - b.takenOn.getTime());
  if (sorted.length === 0) return null;
  const latest = sorted.at(-1)!;
  const recent = sorted.slice(-4);
  let slope = 0; // points per week
  if (recent.length >= 2) {
    const xs = recent.map((p) => p.takenOn.getTime() / WEEK);
    const ys = recent.map((p) => p.total);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    slope = den > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0;
  }
  const weeksSince = Math.max(0, (now.getTime() - latest.takenOn.getTime()) / WEEK);
  let centre = latest.total + clamp(slope * weeksSince, -60, 60);
  if (practice && practice.answered >= 20) centre += practice.accuracy >= 0.75 ? 10 : practice.accuracy < 0.5 ? -10 : 0;
  const width = sorted.length >= 3 ? 40 : 60;
  const mid = clamp(round10(centre), 400, 1600);
  return { low: clamp(mid - width, 400, 1600), high: clamp(mid + width, 400, 1600), mid, basis: { scores: sorted.length, slopePerWeek: Math.round(slope * 10) / 10, practiceAnswered: practice?.answered ?? 0 } };
}

/**
 * Stalling: no gain across the last 3 scores, or the latest is 30+ points
 * below a score from the last 3 weeks before it.
 */
export function stalling(points: ScorePoint[]): { stalled: boolean; reason: string | null } {
  const sorted = [...points].sort((a, b) => a.takenOn.getTime() - b.takenOn.getTime());
  if (sorted.length < 2) return { stalled: false, reason: null };
  const latest = sorted.at(-1)!;
  const windowStart = latest.takenOn.getTime() - 3 * WEEK;
  const recentPeak = sorted.slice(0, -1).filter((p) => p.takenOn.getTime() >= windowStart).reduce((m, p) => Math.max(m, p.total), -Infinity);
  if (recentPeak - latest.total >= 30) return { stalled: true, reason: `Dropped ${recentPeak - latest.total} points in 3 weeks` };
  if (sorted.length >= 3) {
    const last3 = sorted.slice(-3);
    if (last3[2].total <= last3[0].total) return { stalled: true, reason: "No gain over the last 3 scores" };
  }
  return { stalled: false, reason: null };
}

export type StudentScores = { id: string; baseline: number | null; latest: number | null; projected: number | null; target: number };

/** Program dashboard numbers: average and median gain, on-track count, distance to targets, and a distribution. */
export function programStats(students: StudentScores[], targets: number[], goalGain = 300) {
  const withBase = students.filter((s) => s.baseline !== null);
  const withTwo = withBase.filter((s) => s.latest !== null && s.latest !== s.baseline);
  const gains = withBase.filter((s) => s.latest !== null).map((s) => s.latest! - s.baseline!);
  const sortedGains = [...gains].sort((a, b) => a - b);
  const median = sortedGains.length ? (sortedGains.length % 2 ? sortedGains[(sortedGains.length - 1) / 2] : (sortedGains[sortedGains.length / 2 - 1] + sortedGains[sortedGains.length / 2]) / 2) : null;
  const onTrack = withBase.filter((s) => {
    const p = s.projected ?? s.latest;
    return p !== null && (p >= s.baseline! + goalGain || p >= s.target);
  }).length;
  const latest = students.map((s) => s.latest).filter((x): x is number => x !== null);
  const byTarget = targets.map((t) => ({
    target: t,
    reached: latest.filter((x) => x >= t).length,
    averageGap: latest.length ? Math.round(latest.reduce((a, x) => a + Math.max(0, t - x), 0) / latest.length) : null,
  }));
  const bins: { from: number; count: number }[] = [];
  for (let from = 400; from < 1600; from += 100) bins.push({ from, count: latest.filter((x) => x >= from && (from === 1500 ? x <= 1600 : x < from + 100)).length });
  return {
    students: students.length,
    withBaseline: withBase.length,
    missingBaseline: students.length - withBase.length,
    withProgress: withTwo.length,
    averageBaseline: withBase.length ? Math.round(withBase.reduce((a, s) => a + s.baseline!, 0) / withBase.length) : null,
    averageLatest: latest.length ? Math.round(latest.reduce((a, x) => a + x, 0) / latest.length) : null,
    averageGain: gains.length ? Math.round(gains.reduce((a, x) => a + x, 0) / gains.length) : null,
    medianGain: median === null ? null : Math.round(median),
    onTrack,
    byTarget,
    distribution: bins,
  };
}
