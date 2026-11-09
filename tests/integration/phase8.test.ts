import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { recordStudyMinute } from "@/server/activity";
import { getDashboard, getTodaySummary, getUnitScores } from "@/server/dashboard";
import { deletePlan, getPlan, PlanError, savePlan } from "@/server/plan";
import { getPreferences, PreferencesError, savePreferences } from "@/server/preferences";
import { sendDueReminders, unsubscribe, unsubscribeUrl } from "@/server/reminders";
import { setLessonCompleted, setLessonConfusing, submitAttempt } from "@/server/study";
import { reviewFlashcard } from "@/server/srs";
import { markLessonViewed } from "@/server/study";
import type { EmailMessage } from "@/server/email";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/queue", () => ({ enqueueGeneration: async () => {}, enqueueBookProcessing: async () => ({ id: "job" }), enqueueBookEmbedding: async () => {} }));

const NOW = new Date("2026-11-09T15:00:00Z"); // Monday

async function course() {
  const user = await createUser("Sam Student");
  const book = await db.book.create({ data: { userId: user.id, originalFilename: "c.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 20 } });
  const c = await db.course.create({ data: { userId: user.id, bookId: book.id, title: "Circuits", status: "ACTIVE" } });
  const written = { status: "READY" as const, generatedAt: new Date(), content: { objectives: [], explanation: "word ".repeat(2000), workedExamples: [], keyTerms: [] } };
  const u1 = await db.unit.create({ data: { courseId: c.id, order: 0, title: "1 Charge" } });
  const u2 = await db.unit.create({ data: { courseId: c.id, order: 1, title: "2 Ohm" } });
  const lessons = [];
  for (const [i, unit] of [u1, u1, u2, u2].entries()) {
    lessons.push(await db.lesson.create({ data: { courseId: c.id, unitId: unit.id, order: i, title: `Lesson ${i + 1}`, pageStart: i * 4 + 1, pageEnd: i * 4 + 4, ...written } }));
  }
  const q = (lessonId: string, topic: string) =>
    db.question.create({ data: { courseId: c.id, lessonId, type: "MULTIPLE_CHOICE", order: 0, prompt: "?", choices: ["a", "b"], correctChoice: 0, answer: "", explanation: "", topic } });
  const q1 = await q(lessons[0].id, "Charge");
  const q2 = await q(lessons[2].id, "Ohm's law");
  const q3 = await q(lessons[3].id, "Ohm's law");
  return { user, course: c, lessons, units: [u1, u2], questions: [q1, q2, q3] };
}

beforeEach(resetDb);

describe("activity and streaks", () => {
  it("counts minutes once per ~minute, even with several tabs", async () => {
    const { user } = await course();
    expect(await recordStudyMinute(user.id, NOW)).toBe(true);
    expect(await recordStudyMinute(user.id, new Date(NOW.getTime() + 10_000))).toBe(false);
    expect(await recordStudyMinute(user.id, new Date(NOW.getTime() + 61_000))).toBe(true);
    expect((await db.studyDay.findFirstOrThrow()).minutes).toBe(2);
  });

  it("records reviews, answers and completions on the student's local day", async () => {
    const { user, lessons, questions } = await course();
    await db.user.update({ where: { id: user.id }, data: { timezone: "Asia/Tokyo" } });
    await markLessonViewed(user.id, lessons[0].id);
    await submitAttempt(user.id, questions[0].id, { choice: 0 }, { grader: null });
    await setLessonCompleted(user.id, lessons[0].id, true);
    await setLessonCompleted(user.id, lessons[0].id, true); // already complete: not counted twice
    const card = await db.flashcard.create({ data: { courseId: lessons[0].courseId, lessonId: lessons[0].id, order: 0, front: "f", back: "b", pageRefs: [] } });
    await reviewFlashcard(user.id, card.id, 3);
    const day = await db.studyDay.findFirstOrThrow({ where: { userId: user.id } });
    expect(day).toMatchObject({ questionsAnswered: 1, lessonsCompleted: 1, cardsReviewed: 1 });
    expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dashboard", () => {
  it("shows the goal, streak, chart, courses, weak topics and plan", async () => {
    const { user, course: c, lessons, questions } = await course();
    for (const [i, day] of ["2026-11-07", "2026-11-08", "2026-11-09"].entries()) {
      await db.studyDay.create({ data: { userId: user.id, day, minutes: 10 + i * 10, cardsReviewed: 3 } });
    }
    // Wrong twice on "Ohm's law" → a weak topic.
    for (const q of [questions[1], questions[2]]) await submitAttempt(user.id, q.id, { choice: 1 }, { grader: null });
    await setLessonConfusing(user.id, lessons[3].id, true);
    await savePlan(user.id, c.id, { targetDate: "2026-11-20", studyDays: [1, 2, 3, 4, 5], minutesPerDay: 40 }, NOW);

    const d = await getDashboard(user.id, NOW);
    expect(d).toMatchObject({ today: "2026-11-09", goal: { minutes: 30, target: 20 } });
    expect(d.streak).toMatchObject({ current: 3, studiedToday: true });
    expect(d.last14).toHaveLength(14);
    expect(d.last14.at(-1)).toMatchObject({ day: "2026-11-09", minutes: 30 });
    expect(d.courses[0]).toMatchObject({ title: "Circuits", total: 4, done: 0 });
    expect(d.weakTopics.map((w) => w.topic)).toEqual(["Ohm's law"]);
    expect(d.weakTopics[0].lesson?.id).toBeDefined();
    expect(d.confusing.map((l) => l.id)).toEqual([lessons[3].id]);
    expect(d.plan.length).toBeGreaterThan(0);
    expect(d.plan[0]).toMatchObject({ day: "2026-11-09", overdue: false, lessonId: lessons[0].id });

    const summary = await getTodaySummary(user.id, NOW);
    expect(summary).toMatchObject({ hasStudied: true, streak: 3, minutes: 30, goal: 20 });
  });

  it("scores units by each question's latest answer", async () => {
    const { user, course: c, questions } = await course();
    await submitAttempt(user.id, questions[1].id, { choice: 1 }, { grader: null });
    await submitAttempt(user.id, questions[1].id, { choice: 0 }, { grader: null }); // later answer counts
    await submitAttempt(user.id, questions[2].id, { choice: 1 }, { grader: null });
    const scores = await getUnitScores(user.id, c.id);
    expect(scores).toEqual([
      expect.objectContaining({ title: "1 Charge", questions: 1, answered: 0, score: null }),
      expect.objectContaining({ title: "2 Ohm", questions: 2, answered: 2, score: 0.5 }),
    ]);
  });
});

describe("study plan", () => {
  it("plans the remaining lessons and tracks what's done and overdue", async () => {
    const { user, course: c, lessons } = await course();
    await setLessonCompleted(user.id, lessons[0].id, true);
    const res = await savePlan(user.id, c.id, { targetDate: "2026-11-13", studyDays: [1, 3, 5], minutesPerDay: 10 }, NOW);
    expect(res).toMatchObject({ lessons: 3, fits: true, finishDay: "2026-11-13" });
    const { plan } = await getPlan(user.id, c.id, NOW);
    expect(plan!.items.filter((i) => i.kind === "LESSON").map((i) => [i.title, i.day])).toEqual([
      ["Lesson 2", "2026-11-09"],
      ["Lesson 3", "2026-11-11"],
      ["Lesson 4", "2026-11-13"],
    ]);
    // Two days later, with nothing done: one lesson is overdue.
    const later = await getPlan(user.id, c.id, new Date("2026-11-11T15:00:00Z"));
    expect(later.plan).toMatchObject({ overdue: 1, lessonsLeft: 3, daysLeft: 2 });
    await setLessonCompleted(user.id, lessons[1].id, true);
    expect((await getPlan(user.id, c.id, new Date("2026-11-11T15:00:00Z"))).plan).toMatchObject({ overdue: 0, lessonsLeft: 2 });
    // Re-planning replaces the items and leaves out completed lessons.
    await savePlan(user.id, c.id, { targetDate: "2026-11-20", studyDays: [2], minutesPerDay: 120 }, new Date("2026-11-11T15:00:00Z"));
    const replanned = (await getPlan(user.id, c.id, new Date("2026-11-11T15:00:00Z"))).plan!;
    expect(replanned.items.filter((i) => i.kind === "LESSON").map((i) => i.title)).toEqual(["Lesson 3", "Lesson 4"]);
    await deletePlan(user.id, c.id);
    expect((await getPlan(user.id, c.id, NOW)).plan).toBeNull();
  });

  it("says when the plan doesn't fit", async () => {
    const { user, course: c } = await course();
    const res = await savePlan(user.id, c.id, { targetDate: "2026-11-10", studyDays: [1, 2], minutesPerDay: 10 }, NOW);
    expect(res.fits).toBe(false);
    expect(res.neededMinutesPerDay).toBeGreaterThan(10);
  });

  it("validates input and is private", async () => {
    const { user, course: c } = await course();
    const ok = { targetDate: "2026-11-20", studyDays: [1], minutesPerDay: 30 };
    for (const bad of [
      { ...ok, targetDate: "2026-11-01" },
      { ...ok, targetDate: "not a date" },
      { ...ok, targetDate: "2029-01-01" },
      { ...ok, studyDays: [] },
      { ...ok, studyDays: [9] },
      { ...ok, minutesPerDay: 5 },
    ]) {
      await expect(savePlan(user.id, c.id, bad, NOW)).rejects.toBeInstanceOf(PlanError);
    }
    const other = await createUser("Other");
    await expect(savePlan(other.id, c.id, ok, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPlan(other.id, c.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("preferences", () => {
  it("saves and validates study preferences, and new-card limits apply", async () => {
    const { user } = await course();
    await savePreferences(user.id, { dailyGoalMinutes: 45, newCardsPerDay: 5, reminderEmails: true, reminderHour: 7, timezone: "Europe/Paris" });
    expect(await getPreferences(user.id)).toEqual({ dailyGoalMinutes: 45, newCardsPerDay: 5, reminderEmails: true, reminderHour: 7, timezone: "Europe/Paris" });
    const base = { dailyGoalMinutes: 45, newCardsPerDay: 5, reminderEmails: true, reminderHour: 7, timezone: "Europe/Paris" };
    for (const bad of [{ dailyGoalMinutes: 1 }, { newCardsPerDay: -1 }, { reminderHour: 24 }, { timezone: "Mars/Olympus" }]) {
      await expect(savePreferences(user.id, { ...base, ...bad })).rejects.toBeInstanceOf(PreferencesError);
    }
  });
});

describe("reminders", () => {
  it("emails once, in the chosen hour, only if the goal isn't met; unsubscribe link works", async () => {
    const { user } = await course();
    await db.user.update({ where: { id: user.id }, data: { reminderEmails: true, reminderHour: 18, timezone: "America/New_York" } });
    await db.studyDay.create({ data: { userId: user.id, day: "2026-11-08", minutes: 30 } }); // yesterday: streak of 1
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => void sent.push(m);
    const at = new Date("2026-11-09T23:10:00Z"); // 18:10 New York
    expect(await sendDueReminders(new Date("2026-11-09T21:00:00Z"), send)).toBe(0); // 16:00: not yet
    expect(await sendDueReminders(at, send)).toBe(1);
    expect(await sendDueReminders(new Date(at.getTime() + 15 * 60_000), send)).toBe(0); // once a day
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].subject).toBe("Keep your 1-day streak going");
    expect(sent[0].text).toContain("/api/reminders/unsubscribe?u=");
    expect(sent[0].html).not.toContain("<script");

    const url = new URL(unsubscribeUrl(user.id));
    expect(await unsubscribe(user.id, "forged")).toBe(false);
    expect(await unsubscribe("someone-else", url.searchParams.get("s")!)).toBe(false);
    expect(await unsubscribe(user.id, url.searchParams.get("s")!)).toBe(true);
    expect((await getPreferences(user.id)).reminderEmails).toBe(false);
  });

  it("skips students who already met their goal today", async () => {
    const { user } = await course();
    await db.user.update({ where: { id: user.id }, data: { reminderEmails: true, reminderHour: 18, timezone: "America/New_York", dailyGoalMinutes: 20 } });
    await db.studyDay.create({ data: { userId: user.id, day: "2026-11-09", minutes: 25 } });
    expect(await sendDueReminders(new Date("2026-11-09T23:10:00Z"), async () => {})).toBe(0);
  });
});
