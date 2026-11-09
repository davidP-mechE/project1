import { describe, expect, it } from "vitest";
import { courseMastery, lessonMastery, pickPracticeSet, requeue, type Candidate, type QuestionProgress } from "@/lib/mastery/mastery";
import { levelFor, questsFor, totalXp, xpForDay, XP, type DayActivity } from "@/lib/gamification/xp";

const q = (id: string, latestScore: number | null, daysAgo = 1): QuestionProgress => ({
  id,
  latestScore,
  lastAnsweredAt: latestScore === null ? null : new Date(Date.UTC(2026, 10, 9) - daysAgo * 86_400_000),
  attempts: latestScore === null ? 0 : 1,
});

describe("lesson mastery", () => {
  it("is New until something is answered or reviewed", () => {
    expect(lessonMastery([q("a", null), q("b", null)], [{ state: "NEW", stability: 0 }])).toMatchObject({ level: "new", score: 0, answered: 0 });
  });
  it("moves through Learning and Familiar to Mastered", () => {
    expect(lessonMastery([q("a", 0), q("b", 0.5)], []).level).toBe("learning");
    expect(lessonMastery([q("a", 1), q("b", 0.5)], []).level).toBe("familiar");
    expect(lessonMastery([q("a", 1), q("b", 1)], []).level).toBe("mastered");
  });
  it("needs every question answered to be Mastered", () => {
    expect(lessonMastery([q("a", 1), q("b", 1), q("c", null)], []).level).toBe("familiar");
  });
  it("mixes in flashcard memory (30%)", () => {
    const m = lessonMastery([q("a", 1)], [{ state: "REVIEW", stability: 21 }, { state: "NEW", stability: 0 }]);
    expect(m.score).toBeCloseTo(0.7 + 0.3 * 0.5);
    expect(lessonMastery([], [{ state: "REVIEW", stability: 42 }]).score).toBe(1);
  });
  it("averages a course over lessons with something to practise", () => {
    const c = courseMastery([lessonMastery([q("a", 1)], []), lessonMastery([q("b", 0)], []), lessonMastery([], [])]);
    expect(c.score).toBe(0.5);
    expect(c.counts).toEqual({ new: 1, learning: 1, familiar: 0, mastered: 1 });
  });
});

describe("picking a practice set", () => {
  const now = new Date(Date.UTC(2026, 10, 9));
  const c = (id: string, lessonId: string, latestScore: number | null, daysAgo = 1, lessonScore = 0.5): Candidate => ({ ...q(id, latestScore, daysAgo), lessonId, lessonScore });

  it("puts unanswered first, then wrong answers, then the oldest right answers", () => {
    const set = pickPracticeSet([c("right-new", "L1", 1, 1), c("right-old", "L1", 1, 20), c("wrong", "L1", 0), c("unseen", "L1", null)], 4, { now });
    expect(set).toEqual(["unseen", "wrong", "right-old", "right-new"]);
  });
  it("starts with the weakest lesson's unanswered questions", () => {
    const set = pickPracticeSet([c("strong", "L1", null, 0, 0.9), c("weak", "L2", null, 0, 0.1)], 2, { now });
    expect(set[0]).toBe("weak");
  });
  it("spreads a course-wide set across lessons, then fills up", () => {
    const many = [...Array.from({ length: 6 }, (_, i) => c(`a${i}`, "A", null, 0, 0)), ...Array.from({ length: 2 }, (_, i) => c(`b${i}`, "B", null, 0, 0.5))];
    const set = pickPracticeSet(many, 6, { perLesson: 3, now });
    expect(set.filter((id) => id.startsWith("b"))).toHaveLength(2);
    expect(set).toHaveLength(6);
    expect(pickPracticeSet(many, 20, { perLesson: 3, now })).toHaveLength(8);
  });
  it("brings a wrong answer back a few questions later, at most twice", () => {
    const retries = new Map<string, number>();
    let queue = ["q1", "q2", "q3", "q4", "q5"];
    queue = requeue(queue, "q1", false, retries);
    expect(queue).toEqual(["q2", "q3", "q4", "q1", "q5"]);
    queue = requeue(["q1"], "q1", false, retries);
    expect(queue).toEqual(["q1"]);
    expect(requeue(["q1"], "q1", false, retries)).toEqual([]); // third miss: move on
    expect(requeue(["q2", "q3"], "q2", true, retries)).toEqual(["q3"]);
  });
});

describe("XP, levels and quests", () => {
  const day = (over: Partial<DayActivity> = {}): DayActivity => ({ day: "2026-11-09", minutes: 0, cardsReviewed: 0, questionsAnswered: 0, questionsCorrect: 0, lessonsCompleted: 0, ...over });

  it("gives three quests a day, stable for the date, always including a lesson or study-time quest", () => {
    for (const d of ["2026-11-09", "2026-11-10", "2026-12-25", "2027-01-01"]) {
      const quests = questsFor(d, null, 25);
      expect(quests).toHaveLength(3);
      expect(new Set(quests.map((x) => x.id)).size).toBe(3);
      expect(quests.some((x) => x.id === "lesson" || x.id === "minutes")).toBe(true);
      expect(questsFor(d, null, 25)).toEqual(quests);
      const minutes = quests.find((x) => x.id === "minutes");
      if (minutes) expect(minutes).toMatchObject({ target: 25, label: "Study for 25 minutes" });
    }
    const days = Array.from({ length: 14 }, (_, i) => questsFor(`2026-11-${String(i + 1).padStart(2, "0")}`, null).map((x) => x.id).join());
    expect(new Set(days).size).toBeGreaterThan(1); // they rotate
  });

  it("tracks quest progress, capped at the target", () => {
    const quests = questsFor("2026-11-09", day({ questionsAnswered: 40, questionsCorrect: 3, cardsReviewed: 25, lessonsCompleted: 1, minutes: 30 }));
    for (const x of quests) expect(x.progress).toBeLessThanOrEqual(x.target);
    expect(quests.find((x) => x.id === "correct")?.done ?? false).toBe(false);
  });

  it("adds XP for each activity plus completed quests", () => {
    const d = day({ questionsAnswered: 3, questionsCorrect: 2, cardsReviewed: 4, lessonsCompleted: 1, minutes: 5 });
    const done = questsFor(d.day, d).filter((x) => x.done).length;
    expect(xpForDay(d)).toBe(3 * XP.question + 2 * XP.correctBonus + 4 * XP.card + XP.lesson + 5 * XP.minute + done * XP.quest);
    expect(totalXp([d, { ...d, day: "2026-11-10" }])).toBeGreaterThan(xpForDay(d));
    expect(totalXp([])).toBe(0);
  });

  it("levels get longer as you go", () => {
    expect(levelFor(0)).toEqual({ level: 1, intoLevel: 0, levelSize: 100 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toEqual({ level: 2, intoLevel: 0, levelSize: 150 });
    expect(levelFor(250)).toEqual({ level: 3, intoLevel: 0, levelSize: 200 });
    expect(levelFor(1710).level).toBe(7);
  });
});
