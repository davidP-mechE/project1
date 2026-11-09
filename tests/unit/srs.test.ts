import { describe, expect, it } from "vitest";
import { createScheduler, formatInterval, isRating, previewIntervals, reviewCard, type StoredCard } from "@/lib/srs/fsrs";
import { buildQueue, endOfDay, isDue, LEARN_AHEAD_MS, startOfDay } from "@/lib/srs/queue";

const s = createScheduler({ fuzz: false });
const t0 = new Date("2026-11-09T10:00:00Z");
const later = (d: Date, ms: number) => new Date(d.getTime() + ms);
const DAY = 86_400_000;

describe("FSRS scheduling", () => {
  it("a new card rated Again comes back within minutes, Good later, Easy in days", () => {
    const again = reviewCard(null, 1, t0, s);
    const good = reviewCard(null, 3, t0, s);
    const easy = reviewCard(null, 4, t0, s);
    expect(again.state).toBe("LEARNING");
    expect(again.due.getTime() - t0.getTime()).toBeLessThan(15 * 60_000);
    expect(good.due.getTime()).toBeGreaterThan(again.due.getTime());
    expect(easy.state).toBe("REVIEW");
    expect(easy.due.getTime() - t0.getTime()).toBeGreaterThanOrEqual(DAY);
    expect(easy.reps).toBe(1);
  });

  it("intervals grow when you keep remembering, and shrink when you forget", () => {
    let card: StoredCard = reviewCard(null, 4, t0, s);
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const now = card.due;
      card = reviewCard(card, 3, now, s);
      gaps.push(card.due.getTime() - now.getTime());
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    const forgot = reviewCard(card, 1, card.due, s);
    expect(forgot.state).toBe("RELEARNING");
    expect(forgot.lapses).toBe(1);
    expect(forgot.due.getTime() - card.due.getTime()).toBeLessThan(DAY);
  });

  it("previews one label per button, in increasing order", () => {
    const p = previewIntervals(null, t0, s);
    expect(Object.keys(p)).toEqual(["1", "2", "3", "4"]);
    expect(p[1]).toMatch(/m$/);
    expect(p[4]).toMatch(/d$/);
  });

  it("validates ratings", () => {
    expect([1, 2, 3, 4].every(isRating)).toBe(true);
    for (const bad of [0, 5, "3", 2.5, null]) expect(isRating(bad)).toBe(false);
  });

  it("formats intervals", () => {
    expect(formatInterval(20_000)).toBe("<1m");
    expect(formatInterval(10 * 60_000)).toBe("10m");
    expect(formatInterval(3 * 3600_000)).toBe("3h");
    expect(formatInterval(4 * DAY)).toBe("4d");
    expect(formatInterval(65 * DAY)).toBe("2mo");
    expect(formatInterval(550 * DAY)).toBe("1.5y");
  });
});

describe("daily queue", () => {
  const now = new Date("2026-11-09T15:00:00Z");
  const eod = new Date("2026-11-10T00:00:00Z");
  const c = (id: string, due: Date, state: "LEARNING" | "REVIEW" | "RELEARNING" = "REVIEW") => ({ flashcardId: id, due, state });

  it("shows review cards due today and learning cards due soon, oldest first", () => {
    expect(isDue(c("a", later(now, 5 * 3600_000)), now, eod)).toBe(true); // review later today
    expect(isDue(c("b", later(now, 10 * 3600_000)), now, eod)).toBe(false); // tomorrow
    expect(isDue(c("c", later(now, LEARN_AHEAD_MS - 1000), "LEARNING"), now, eod)).toBe(true);
    expect(isDue(c("d", later(now, 2 * 3600_000), "LEARNING"), now, eod)).toBe(false); // learning: not hours early
    const q = buildQueue({
      scheduled: [c("late", later(now, 3600_000)), c("old", later(now, -2 * DAY)), c("tomorrow", later(now, DAY))],
      newCandidates: ["n1", "n2"],
      newIntroducedToday: 0,
      now,
      endOfToday: eod,
    });
    expect(q).toEqual({ due: ["old", "late"], fresh: ["n1", "n2"] });
  });

  it("limits new cards per day, counting ones already started today", () => {
    const fresh = Array.from({ length: 30 }, (_, i) => `n${i}`);
    expect(buildQueue({ scheduled: [], newCandidates: fresh, newIntroducedToday: 0, now, endOfToday: eod }).fresh).toHaveLength(20);
    expect(buildQueue({ scheduled: [], newCandidates: fresh, newIntroducedToday: 15, now, endOfToday: eod }).fresh).toHaveLength(5);
    expect(buildQueue({ scheduled: [], newCandidates: fresh, newIntroducedToday: 25, now, endOfToday: eod }).fresh).toHaveLength(0);
  });

  it("caps the session size", () => {
    const many = Array.from({ length: 10 }, (_, i) => c(`r${i}`, later(now, -i * 1000)));
    const q = buildQueue({ scheduled: many, newCandidates: ["n"], newIntroducedToday: 0, now, endOfToday: eod, limit: 10 });
    expect(q.due).toHaveLength(10);
    expect(q.fresh).toHaveLength(0);
  });
});

describe("the student's day", () => {
  it("finds midnight in the student's time zone", () => {
    const at = new Date("2026-11-09T05:30:00Z"); // 21:30 on Nov 8 in Los Angeles (PST, UTC-8)
    expect(startOfDay(at, "America/Los_Angeles").toISOString()).toBe("2026-11-08T08:00:00.000Z");
    expect(endOfDay(at, "America/Los_Angeles").toISOString()).toBe("2026-11-09T08:00:00.000Z");
    expect(startOfDay(at, "Asia/Kolkata").toISOString()).toBe("2026-11-08T18:30:00.000Z"); // UTC+5:30
    expect(startOfDay(at, "UTC").toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("handles daylight-saving days and bad zones", () => {
    // 2026-03-08 is 23 hours long in New York.
    const dst = new Date("2026-03-08T12:00:00Z");
    expect(startOfDay(dst, "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(endOfDay(dst, "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(startOfDay(dst, "Not/AZone").toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });
});
