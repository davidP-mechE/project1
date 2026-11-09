/**
 * Plan limits: how much each student can use per month. Pure functions, so the
 * same rules drive enforcement (server), the usage meter (Settings) and tests.
 *
 * Limits are keyed by `User.plan`. Payments (e.g. Stripe) can come later: a
 * webhook only has to set the plan. Operators can change the numbers with
 * environment variables (see `limitsFromEnv`).
 */

export type PlanName = "FREE" | "PRO";

export type PlanLimits = {
  /** Claude API spend per calendar month (UTC), in US dollars. The real backstop on cost. */
  monthlyAiUsd: number;
  /** Textbook pages turned into lessons per calendar month (each lesson counts once a month). */
  pagesPerMonth: number;
  /** Books (courses) stored at once. */
  maxBooks: number;
  /** Total size of stored PDFs, in bytes. */
  storageBytes: number;
};

const GB = 1024 * 1024 * 1024;

export const DEFAULT_LIMITS: Record<PlanName, PlanLimits> = {
  FREE: { monthlyAiUsd: 5, pagesPerMonth: 500, maxBooks: 10, storageBytes: 2 * GB },
  PRO: { monthlyAiUsd: 50, pagesPerMonth: 5_000, maxBooks: 100, storageBytes: 20 * GB },
};

/** Operator overrides, e.g. FREE_MONTHLY_AI_USD=20 or PRO_PAGES_PER_MONTH=10000. Invalid values are ignored. */
export function limitsFromEnv(source: Record<string, string | undefined>): Record<PlanName, PlanLimits> {
  const num = (key: string) => {
    const v = source[key];
    if (v === undefined || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const out = {} as Record<PlanName, PlanLimits>;
  for (const plan of ["FREE", "PRO"] as const) {
    const d = DEFAULT_LIMITS[plan];
    const gb = num(`${plan}_STORAGE_GB`);
    out[plan] = {
      monthlyAiUsd: num(`${plan}_MONTHLY_AI_USD`) ?? d.monthlyAiUsd,
      pagesPerMonth: Math.floor(num(`${plan}_PAGES_PER_MONTH`) ?? d.pagesPerMonth),
      maxBooks: Math.floor(num(`${plan}_MAX_BOOKS`) ?? d.maxBooks),
      storageBytes: gb !== undefined ? Math.floor(gb * GB) : d.storageBytes,
    };
  }
  return out;
}

/** Start of the current usage period: the first day of the month, 00:00 UTC. */
export function periodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** When the current period ends (and usage resets). */
export function periodEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type Usage = {
  aiUsd: number;
  pages: number;
  books: number;
  storageBytes: number;
};

export type LimitCheck = { ok: true } | { ok: false; error: string };

const usd = (n: number) => `$${n.toFixed(2)}`;
const resetsOn = (now: Date) =>
  periodEnd(now).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** Room left for anything that calls Claude (grading, tutor, generation). */
export function checkAiBudget(usage: Pick<Usage, "aiUsd">, limits: PlanLimits, now: Date): LimitCheck {
  if (usage.aiUsd >= limits.monthlyAiUsd) {
    return {
      ok: false,
      error: `You've used this month's AI allowance (${usd(limits.monthlyAiUsd)}). It resets on ${resetsOn(now)}.`,
    };
  }
  return { ok: true };
}

/**
 * Can these lessons be written now? `newPages` counts only lessons not already
 * written this month; `estimateUsd` is the generation estimate for them.
 */
export function checkGeneration(
  usage: Pick<Usage, "aiUsd" | "pages">,
  request: { newPages: number; estimateUsd: number },
  limits: PlanLimits,
  now: Date,
): LimitCheck {
  const budget = checkAiBudget(usage, limits, now);
  if (!budget.ok) return budget;
  const pagesLeft = Math.max(0, limits.pagesPerMonth - usage.pages);
  if (request.newPages > pagesLeft) {
    return {
      ok: false,
      error:
        pagesLeft === 0
          ? `You've turned ${limits.pagesPerMonth} pages into lessons this month, the monthly limit. It resets on ${resetsOn(now)}.`
          : `This needs ${request.newPages} pages, but you have ${pagesLeft} of ${limits.pagesPerMonth} pages left this month. Skip some lessons in the outline, or wait until ${resetsOn(now)}.`,
    };
  }
  const usdLeft = limits.monthlyAiUsd - usage.aiUsd;
  if (request.estimateUsd > usdLeft) {
    return {
      ok: false,
      error: `This would cost about ${usd(request.estimateUsd)}, but ${usd(usdLeft)} of this month's ${usd(limits.monthlyAiUsd)} AI allowance is left. Skip some lessons, or wait until ${resetsOn(now)}.`,
    };
  }
  return { ok: true };
}

/** Can another book of this size be uploaded? */
export function checkUpload(usage: Pick<Usage, "books" | "storageBytes">, sizeBytes: number, limits: PlanLimits): LimitCheck {
  if (usage.books >= limits.maxBooks) {
    return { ok: false, error: `You can keep up to ${limits.maxBooks} books. Delete a course you've finished to upload another.` };
  }
  if (usage.storageBytes + sizeBytes > limits.storageBytes) {
    const left = Math.max(0, limits.storageBytes - usage.storageBytes);
    return {
      ok: false,
      error: `This file doesn't fit in your storage (${formatSize(left)} left of ${formatSize(limits.storageBytes)}). Delete a course you've finished to make room.`,
    };
  }
  return { ok: true };
}

export function formatSize(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export type Meter = { key: keyof Usage; label: string; used: number; limit: number; fraction: number; text: string };

/** The rows of the usage meter on the Settings page. */
export function usageMeters(usage: Usage, limits: PlanLimits): Meter[] {
  const row = (key: keyof Usage, label: string, used: number, limit: number, text: string): Meter => ({
    key,
    label,
    used,
    limit,
    fraction: limit <= 0 ? 1 : Math.min(1, used / limit),
    text,
  });
  return [
    row("aiUsd", "AI usage this month", usage.aiUsd, limits.monthlyAiUsd, `${usd(usage.aiUsd)} of ${usd(limits.monthlyAiUsd)}`),
    row("pages", "Pages turned into lessons this month", usage.pages, limits.pagesPerMonth, `${usage.pages} of ${limits.pagesPerMonth}`),
    row("books", "Books", usage.books, limits.maxBooks, `${usage.books} of ${limits.maxBooks}`),
    row("storageBytes", "Storage", usage.storageBytes, limits.storageBytes, `${formatSize(usage.storageBytes)} of ${formatSize(limits.storageBytes)}`),
  ];
}
