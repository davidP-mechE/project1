import { describe, expect, it } from "vitest";
import { courseProgress, percentComplete, resumeLesson, type ProgressLesson } from "@/lib/progress/progress";

const t = (min: number) => new Date(Date.UTC(2026, 10, 9, 10, min));
const L = (id: string, unitId: string, o: Partial<ProgressLesson> = {}): ProgressLesson => ({ id, unitId, ready: true, completedAt: null, lastViewedAt: null, ...o });

describe("percentComplete", () => {
  it("rounds and handles empty courses", () => {
    expect(percentComplete(0, 0)).toBe(0);
    expect(percentComplete(1, 3)).toBe(33);
    expect(percentComplete(2, 3)).toBe(67);
    expect(percentComplete(5, 5)).toBe(100);
  });
});

describe("courseProgress", () => {
  it("counts completed lessons overall and per unit", () => {
    const p = courseProgress([L("a", "u1", { completedAt: t(1) }), L("b", "u1"), L("c", "u2", { completedAt: t(2) }), L("d", "u2", { completedAt: t(3) })]);
    expect(p).toMatchObject({ done: 3, total: 4, pct: 75 });
    expect(p.units.get("u1")).toEqual({ done: 1, total: 2, pct: 50 });
    expect(p.units.get("u2")).toEqual({ done: 2, total: 2, pct: 100 });
  });
});

describe("resumeLesson", () => {
  it("starts at the first ready lesson for a new student", () => {
    expect(resumeLesson([L("a", "u", { ready: false }), L("b", "u"), L("c", "u")])).toEqual({ id: "b", reason: "start" });
  });
  it("continues the most recently viewed unfinished lesson", () => {
    const ls = [L("a", "u", { lastViewedAt: t(5) }), L("b", "u", { lastViewedAt: t(9) }), L("c", "u")];
    expect(resumeLesson(ls)).toEqual({ id: "b", reason: "continue" });
  });
  it("moves to the next unfinished lesson after a finished one", () => {
    const ls = [L("a", "u"), L("b", "u", { lastViewedAt: t(9), completedAt: t(9) }), L("c", "u", { completedAt: t(1) }), L("d", "u")];
    expect(resumeLesson(ls)).toEqual({ id: "d", reason: "next" });
  });
  it("wraps around to earlier lessons left unfinished", () => {
    const ls = [L("a", "u"), L("b", "u", { lastViewedAt: t(9), completedAt: t(9) })];
    expect(resumeLesson(ls)).toEqual({ id: "a", reason: "next" });
  });
  it("skips lessons that aren't written yet and returns null when all done", () => {
    expect(resumeLesson([L("a", "u", { completedAt: t(1) }), L("b", "u", { ready: false })])).toBeNull();
    expect(resumeLesson([])).toBeNull();
  });
});
