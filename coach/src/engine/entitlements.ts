/**
 * Entitlements (spec: "Free vs paid" and "How to build the paywall").
 *
 * Pure rules; the server checks them on every request. The client only hides or
 * shows buttons. Safety, crisis resources and view/export/delete are never gated.
 */

export type Tier = "free" | "plus" | "advanced";

export type Entitlements = {
  tier: Tier;
  /** Sessions a user can start per rolling week. null = unlimited. */
  sessionsPerWeek: number | null;
  /** How many past sessions memory can draw on. null = full history. */
  memorySessions: number | null;
  /** Full multi-pass engine: model critic pass and memory retrieval by similarity. */
  fullPipeline: boolean;
  /** Advanced: deeper chain analysis. */
  deeperChainAnalysis: boolean;
  /** Pattern map; free users get one real pattern preview per month. */
  patterns: "preview" | "full" | "full_long";
  patternLookbackDays: number;
  progress: "snapshot" | "full" | "detailed";
  weeklyReport: boolean;
  spokenReplies: boolean;
  /** Cost guardrail: monthly cap on model spend, in US cents. */
  monthlyModelBudgetCents: number;
};

export const PRICES = { plus: 1499, advanced: 2499 } as const;

export function entitlementsFor(tier: Tier): Entitlements {
  switch (tier) {
    case "advanced":
      return { tier, sessionsPerWeek: null, memorySessions: null, fullPipeline: true, deeperChainAnalysis: true, patterns: "full_long", patternLookbackDays: 365, progress: "detailed", weeklyReport: true, spokenReplies: false, monthlyModelBudgetCents: Math.round(PRICES.advanced * 0.15) };
    case "plus":
      return { tier, sessionsPerWeek: null, memorySessions: null, fullPipeline: true, deeperChainAnalysis: false, patterns: "full", patternLookbackDays: 120, progress: "full", weeklyReport: true, spokenReplies: false, monthlyModelBudgetCents: Math.round(PRICES.plus * 0.15) };
    default:
      return { tier: "free", sessionsPerWeek: 3, memorySessions: 3, fullPipeline: false, deeperChainAnalysis: false, patterns: "preview", patternLookbackDays: 90, progress: "snapshot", weeklyReport: false, spokenReplies: false, monthlyModelBudgetCents: 50 };
  }
}

export type Account = { tier: Tier; trialEndsAt: Date | null; completedSessions: number };

/** A 7-day Plus trial counts as Plus. A new user's first session is Plus quality. */
export function effectiveTier(a: Account, now = new Date()): Tier {
  if (a.tier !== "free") return a.tier;
  if (a.trialEndsAt && a.trialEndsAt > now) return "plus";
  return "free";
}

export function pipelineTier(a: Account, now = new Date()): Tier {
  const t = effectiveTier(a, now);
  return t === "free" && a.completedSessions === 0 ? "plus" : t;
}

export type StartCheck = { allowed: true } | { allowed: false; nextAvailableAt: Date; message: string };

/**
 * Limits apply to starting sessions, never to a session in progress
 * (spec: "Never cut a free session short mid-insight").
 */
export function canStartSession(e: Entitlements, sessionStartsLastWeek: Date[], now = new Date()): StartCheck {
  if (e.sessionsPerWeek === null) return { allowed: true };
  const weekAgo = now.getTime() - 7 * 864e5;
  const recent = sessionStartsLastWeek.filter((d) => d.getTime() > weekAgo).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < e.sessionsPerWeek) return { allowed: true };
  const nextAvailableAt = new Date(recent[recent.length - e.sessionsPerWeek].getTime() + 7 * 864e5);
  const when = nextAvailableAt.toLocaleDateString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  return {
    allowed: false,
    nextAvailableAt,
    message: `You've used this week's ${e.sessionsPerWeek} free sessions. Your next one opens ${when}. Plus has unlimited sessions and remembers your full history, so it can connect things across weeks. Crisis resources and your data are always available either way.`,
  };
}

/** Free users see one real, evidence-backed pattern per calendar month. */
export function canPreviewPattern(e: Entitlements, lastPreviewAt: Date | null, now = new Date()): boolean {
  if (e.patterns !== "preview") return true;
  if (!lastPreviewAt) return true;
  return lastPreviewAt.getUTCFullYear() !== now.getUTCFullYear() || lastPreviewAt.getUTCMonth() !== now.getUTCMonth();
}
