import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatDay, isDay, localDay, localHour, weekday } from "@/lib/planning/dates";
import { isActive, streaks } from "@/lib/planning/streaks";
import { topicScores, weakTopics } from "@/lib/planning/weak-topics";
import { buildPlan, estimateLessonMinutes, REVIEW_MINUTES, studyDaysBetween } from "@/lib/planning/study-plan";
import { shouldRemind } from "@/lib/planning/reminders";

describe("local days", () => {
  it("uses the student's time zone", () => {
    const at = new Date("2026-11-09T05:30:00Z");
    expect(localDay(at, "UTC")).toBe("2026-11-09");
    expect(localDay(at, "America/Los_Angeles")).toBe("2026-11-08");
    expect(localDay(at, "Asia/Tokyo")).toBe("2026-11-09");
    expect(localHour(at, "Asia/Kolkata")).toBe(11);
    expect(localDay(at, "Bad/Zone")).toBe("2026-11-09");
  });
  it("does calendar arithmetic", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-11-09", "2026-12-07")).toBe(28);
    expect(weekday("2026-11-09")).toBe(1); // Monday
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-11-09")).toBe(true);
    expect(isDay("nope")).toBe(false);
    expect(formatDay("2026-11-09")).toBe("Mon, Nov 9");
  });
});

describe("streaks", () => {
  const today = "2026-11-09";
  it("counts back from today", () => expect(streaks(["2026-11-07", "2026-11-08", "2026-11-09"], today)).toMatchObject({ current: 3, studiedToday: true }));
  it("stays alive until a whole day is missed", () => {
    expect(streaks(["2026-11-07", "2026-11-08"], today)).toMatchObject({ current: 2, studiedToday: false, alive: true });
    expect(streaks(["2026-11-06", "2026-11-07"], today)).toMatchObject({ current: 0, alive: false });
  });
  it("finds the longest run", () => {
    expect(streaks(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-09"], today)).toMatchObject({ current: 1, longest: 4 });
    expect(streaks([], today)).toEqual({ current: 0, longest: 0, alive: false, studiedToday: false });
  });
  it("any activity counts as a study day", () => {
    expect(isActive({ minutes: 0, cardsReviewed: 1, questionsAnswered: 0, lessonsCompleted: 0 })).toBe(true);
    expect(isActive({ minutes: 0, cardsReviewed: 0, questionsAnswered: 0, lessonsCompleted: 0 })).toBe(false);
  });
});

describe("weak topics", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const a = (topic: string, score: number, days = 0, lessonId = "l1") => ({ topic, score, createdAt: ago(days), lessonId });

  it("flags topics answered wrong repeatedly, not after one slip", () => {
    const weak = weakTopics([a("Ohm's law", 0), a("Ohm's law", 0.2), a("Units", 0), a("Charge", 1), a("Charge", 1)], now);
    expect(weak.map((w) => w.topic)).toEqual(["Ohm's law"]);
    expect(weak[0].score).toBeLessThan(0.4);
  });
  it("treats topic names case-insensitively and counts recent answers more", () => {
    const old = topicScores([a("ohm's law", 0, 60), a("Ohm's Law", 0, 60), a("Ohm's law", 1, 0), a("Ohm's law", 1, 0)], now);
    expect(old).toHaveLength(1);
    expect(old[0].score).toBeGreaterThan(0.8); // recent successes outweigh old mistakes
    expect(old[0].attempts).toBe(4);
  });
  it("partial credit counts", () => {
    expect(weakTopics([a("KCL", 0.5), a("KCL", 0.5), a("KCL", 0.5)], now).map((w) => w.topic)).toEqual(["KCL"]);
    expect(weakTopics([a("KCL", 0.8), a("KCL", 0.8)], now)).toEqual([]);
  });
});

describe("study plan", () => {
  const L = (n: number, minutes = 30) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, minutes }));
  const weekdays = [1, 2, 3, 4, 5];

  it("estimates lesson time", () => {
    expect(estimateLessonMinutes(2000, 5)).toBe(20);
    expect(estimateLessonMinutes(100, 0)).toBe(10);
  });
  it("lists study days on chosen weekdays", () => {
    expect(studyDaysBetween("2026-11-09", "2026-11-15", weekdays)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(studyDaysBetween("2026-11-09", "2026-11-15", [0, 6])).toEqual(["2026-11-14", "2026-11-15"]);
  });
  it("paces lessons evenly to the finish date when there's room, with a daily review", () => {
    const r = buildPlan({ lessons: L(5, 20), start: "2026-11-09", target: "2026-11-20", weekdays, minutesPerDay: 50 });
    expect(r.fits).toBe(true);
    const lessonDays = r.items.filter((i) => i.kind === "LESSON").map((i) => [i.lessonId, i.day]);
    // 10 study days, 5 lessons: every other study day, in order.
    expect(lessonDays).toEqual([
      ["l1", "2026-11-09"],
      ["l2", "2026-11-11"],
      ["l3", "2026-11-13"],
      ["l4", "2026-11-17"],
      ["l5", "2026-11-19"],
    ]);
    expect(r.finishDay).toBe("2026-11-19");
    // Reviews continue on every study day up to the target.
    expect(r.items.filter((i) => i.kind === "REVIEW").map((i) => i.day)).toEqual(studyDaysBetween("2026-11-09", "2026-11-20", weekdays));
    expect(r.items.find((i) => i.kind === "REVIEW")!.minutes).toBe(REVIEW_MINUTES);
  });
  it("fills days up to the daily minutes when time is tight", () => {
    const r = buildPlan({ lessons: L(6, 20), start: "2026-11-09", target: "2026-11-11", weekdays, minutesPerDay: 50 });
    expect(r.fits).toBe(true);
    expect(r.items.filter((i) => i.kind === "LESSON").map((i) => i.day)).toEqual(["2026-11-09", "2026-11-09", "2026-11-10", "2026-11-10", "2026-11-11", "2026-11-11"]);
  });
  it("never skips a day for a long lesson, and says when it won't fit", () => {
    const r = buildPlan({ lessons: L(10, 60), start: "2026-11-09", target: "2026-11-13", weekdays, minutesPerDay: 30 });
    expect(r.fits).toBe(false);
    expect(r.finishDay).toBe("2026-11-20"); // 10 weekdays, one long lesson each
    expect(r.neededMinutesPerDay).toBe(120 + REVIEW_MINUTES); // 600 min over 5 days
    expect(new Set(r.items.filter((i) => i.kind === "LESSON").map((i) => i.day)).size).toBe(10);
  });
  it("handles no lessons left and no study days", () => {
    expect(buildPlan({ lessons: [], start: "2026-11-09", target: "2026-11-11", weekdays, minutesPerDay: 30 })).toMatchObject({ fits: true, finishDay: null });
    expect(buildPlan({ lessons: L(1), start: "2026-11-09", target: "2026-11-11", weekdays: [], minutesPerDay: 30, review: false }).items).toEqual([]);
  });
});

describe("reminders", () => {
  const user = { reminderEmails: true, reminderHour: 18, timezone: "America/New_York", lastReminderOn: null, emailVerified: true };
  const at6pmNY = new Date("2026-11-09T23:10:00Z"); // 18:10 in New York (EST)
  it("sends in the student's chosen local hour if today's goal isn't met", () => {
    expect(shouldRemind(user, 5, 20, at6pmNY)).toBe(true);
    expect(shouldRemind(user, 20, 20, at6pmNY)).toBe(false); // goal met
    expect(shouldRemind(user, 5, 20, new Date("2026-11-09T22:10:00Z"))).toBe(false); // 17:10
  });
  it("sends at most once a day, only when turned on and verified", () => {
    expect(shouldRemind({ ...user, lastReminderOn: "2026-11-09" }, 0, 20, at6pmNY)).toBe(false);
    expect(shouldRemind({ ...user, lastReminderOn: "2026-11-08" }, 0, 20, at6pmNY)).toBe(true);
    expect(shouldRemind({ ...user, reminderEmails: false }, 0, 20, at6pmNY)).toBe(false);
    expect(shouldRemind({ ...user, emailVerified: false }, 0, 20, at6pmNY)).toBe(false);
  });
});
