import { describe, expect, it } from "vitest";
import { canPreviewPattern, canStartSession, effectiveTier, entitlementsFor, pipelineTier } from "@/engine/entitlements";

const now = new Date("2027-02-10T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 864e5);

describe("entitlements", () => {
  it("free: 3 sessions per rolling week, with an honest next-available time", () => {
    const e = entitlementsFor("free");
    expect(canStartSession(e, [daysAgo(1), daysAgo(2)], now).allowed).toBe(true);
    const r = canStartSession(e, [daysAgo(1), daysAgo(2), daysAgo(6)], now);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.nextAvailableAt.getTime()).toBe(daysAgo(6).getTime() + 7 * 864e5);
      expect(r.message).toMatch(/Crisis resources and your data are always available/);
    }
  });
  it("paid: unlimited", () => {
    expect(canStartSession(entitlementsFor("plus"), Array(20).fill(daysAgo(1)), now).allowed).toBe(true);
  });
  it("trial counts as Plus; a new user's first session is Plus quality", () => {
    expect(effectiveTier({ tier: "free", trialEndsAt: daysAgo(-3), completedSessions: 5 }, now)).toBe("plus");
    expect(pipelineTier({ tier: "free", trialEndsAt: null, completedSessions: 0 }, now)).toBe("plus");
    expect(pipelineTier({ tier: "free", trialEndsAt: null, completedSessions: 1 }, now)).toBe("free");
  });
  it("one pattern preview per calendar month for free users", () => {
    const e = entitlementsFor("free");
    expect(canPreviewPattern(e, null, now)).toBe(true);
    expect(canPreviewPattern(e, daysAgo(3), now)).toBe(false);
    expect(canPreviewPattern(e, daysAgo(15), now)).toBe(true);
  });
  it("cost guardrail is about 15% of the price", () => {
    expect(entitlementsFor("plus").monthlyModelBudgetCents).toBe(225);
  });
});
