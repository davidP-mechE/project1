import { describe, expect, it } from "vitest";
import { buildPlan, estimateSection, gridInMatches, nextReview, parseGridIn, routeFor } from "@/lib/sat/practice";

describe("grid-in answers", () => {
  it("accepts equivalent forms and rejects others", () => {
    expect(parseGridIn("3/4")).toBe(0.75);
    expect(parseGridIn(".75")).toBe(0.75);
    expect(parseGridIn("1,000")).toBe(1000);
    expect(parseGridIn("abc")).toBeNull();
    expect(parseGridIn("1/0")).toBeNull();
    expect(gridInMatches("3/4", "0.75")).toBe(true);
    expect(gridInMatches(".75", "3/4")).toBe(true);
    expect(gridInMatches("0.75", "0.7")).toBe(false);
    expect(gridInMatches("2 or -3", "-3")).toBe(true);
    expect(gridInMatches("2 or -3", "3")).toBe(false);
    expect(gridInMatches("x + 1", "X + 1")).toBe(true);
  });
});

describe("diagnostic routing and estimates", () => {
  it("routes on module 1 and caps the easier route", () => {
    expect(routeFor(9, 9)).toBe("M2_HARD");
    expect(routeFor(8, 9)).toBe("M2_EASY");
    expect(estimateSection(27, 27, "M2_HARD")).toBe(800);
    expect(estimateSection(27, 27, "M2_EASY")).toBe(640);
    expect(estimateSection(0, 27, "M2_HARD")).toBe(200);
    expect(estimateSection(14, 27, "M2_HARD")).toBe(510);
  });
});

describe("mistake log spacing", () => {
  it("comes back after 1 day when wrong, and retires after two right in a row", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(nextReview(1, false, now)).toEqual({ streak: 0, due: new Date("2026-11-11T00:00:00Z"), retired: false });
    expect(nextReview(0, true, now)).toEqual({ streak: 1, due: new Date("2026-11-13T00:00:00Z"), retired: false });
    expect(nextReview(1, true, now)).toMatchObject({ streak: 2, retired: true });
  });
});

describe("pacing plan", () => {
  it("runs weekly to the test date: weakest first, checkpoints every 4 weeks, review last", () => {
    const plan = buildPlan({
      now: new Date("2026-11-10T15:00:00Z"),
      testDate: new Date("2027-01-09T00:00:00Z"),
      accuracy: { "advanced-math": 0.3, conventions: 0.4, algebra: 0.9 },
      assignments: [{ title: "Week 2 set", dueAt: new Date("2026-11-19T12:00:00Z") }, { title: "No date", dueAt: null }],
    });
    expect(plan).toHaveLength(9);
    expect(plan[0].focus).toEqual(["advanced-math", "conventions"]);
    expect(plan.at(-1)).toMatchObject({ finalReview: true, focus: [] });
    expect(plan.at(-1)!.end.toISOString().slice(0, 10)).toBe("2027-01-09");
    expect(plan.filter((w) => w.checkpoint).map((w) => plan.indexOf(w))).toEqual([3, 7]);
    expect(plan[1].assignments.map((a) => a.title)).toEqual(["Week 2 set"]);
    expect(plan.flatMap((w) => w.focus)).not.toContain(undefined);
    expect(buildPlan({ now: new Date("2027-02-01"), testDate: new Date("2027-01-09"), accuracy: {}, assignments: [] })).toEqual([]);
  });
});
