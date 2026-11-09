import "server-only";
import { db } from "./db";
import { env } from "./env";
import {
  checkAiBudget,
  checkGeneration,
  checkUpload,
  limitsFromEnv,
  periodEnd,
  periodStart,
  type PlanLimits,
  type PlanName,
  type Usage,
} from "@/lib/usage/limits";
import { getGenerationEstimate } from "./outline";
import { AiError } from "./ai/writer";

/**
 * Enforces the plan limits in src/lib/usage/limits.ts. Every check reads the
 * student's real usage from the database (Claude costs are recorded per call
 * in UsageEvent), so the numbers can't drift.
 */

export class LimitError extends Error {
  readonly status = 429;
}

const PLAN_LIMITS = limitsFromEnv(process.env);

export function limitsForPlan(plan: PlanName): PlanLimits {
  return PLAN_LIMITS[plan];
}

async function planOf(userId: string): Promise<PlanName> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  return u?.plan ?? "FREE";
}

/** Claude spend so far this month, in dollars. */
export async function aiUsdThisMonth(userId: string, now = new Date()): Promise<number> {
  const agg = await db.usageEvent.aggregate({ where: { userId, createdAt: { gte: periodStart(now) } }, _sum: { costMicroUsd: true } });
  return (agg._sum.costMicroUsd ?? 0) / 1_000_000;
}

/** Ids of lessons written (or rewritten) this month. Each counts once toward the page limit. */
async function lessonsWrittenThisMonth(userId: string, now: Date): Promise<string[]> {
  const rows = await db.usageEvent.findMany({
    where: { userId, feature: "LESSON", lessonId: { not: null }, createdAt: { gte: periodStart(now) } },
    distinct: ["lessonId"],
    select: { lessonId: true },
  });
  return rows.map((r) => r.lessonId!);
}

async function pagesOf(lessonIds: string[]): Promise<number> {
  if (lessonIds.length === 0) return 0;
  const lessons = await db.lesson.findMany({ where: { id: { in: lessonIds } }, select: { pageStart: true, pageEnd: true } });
  return lessons.reduce((sum, l) => sum + (l.pageEnd - l.pageStart + 1), 0);
}

export async function getUsage(userId: string, now = new Date()): Promise<{ plan: PlanName; limits: PlanLimits; usage: Usage; resetsAt: Date }> {
  const [plan, aiUsd, written, books] = await Promise.all([
    planOf(userId),
    aiUsdThisMonth(userId, now),
    lessonsWrittenThisMonth(userId, now),
    db.book.aggregate({ where: { userId }, _count: { _all: true }, _sum: { sizeBytes: true } }),
  ]);
  return {
    plan,
    limits: limitsForPlan(plan),
    usage: {
      aiUsd,
      pages: await pagesOf(written),
      books: books._count._all,
      storageBytes: Number(books._sum.sizeBytes ?? 0),
    },
    resetsAt: periodEnd(now),
  };
}

/** Before anything calls Claude for this student: is there allowance left this month? */
export async function assertAiBudget(userId: string, now = new Date()) {
  const [plan, aiUsd] = await Promise.all([planOf(userId), aiUsdThisMonth(userId, now)]);
  const check = checkAiBudget({ aiUsd }, limitsForPlan(plan), now);
  if (!check.ok) throw new LimitError(check.error);
}

/** Before queueing lessons to be written: do their pages and estimated cost fit this month's allowance? */
export async function assertCanGenerate(userId: string, courseId: string, lessonIds: string[], now = new Date()) {
  if (lessonIds.length === 0) return;
  const { limits, usage } = await getUsage(userId, now);
  const already = new Set(await lessonsWrittenThisMonth(userId, now));
  const newPages = await pagesOf(lessonIds.filter((id) => !already.has(id)));
  // Demo mode costs nothing, so only its pages count.
  const estimateUsd = env.FAKE_CLAUDE ? 0 : (await getGenerationEstimate(userId, courseId, { lessonIds })).costUsd;
  const check = checkGeneration(usage, { newPages, estimateUsd }, limits, now);
  if (!check.ok) throw new LimitError(check.error);
}

/** Before creating an upload: room for another book of this size? */
export async function assertCanUpload(userId: string, sizeBytes: number) {
  const { limits, usage } = await getUsage(userId);
  const check = checkUpload(usage, sizeBytes, limits);
  if (!check.ok) throw new LimitError(check.error);
}

/** In the worker: stops a job (without retrying) when the student has used this month's AI allowance. */
export async function ensureAiBudget(userId: string) {
  try {
    await assertAiBudget(userId);
  } catch (err) {
    if (err instanceof LimitError) throw new AiError("limit", err.message);
    throw err;
  }
}
