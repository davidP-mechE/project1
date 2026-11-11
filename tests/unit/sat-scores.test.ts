import { describe, expect, it } from "vitest";
import { MissedSchema, programStats, projectScore, ScoreInputSchema, stalling } from "@/lib/sat/scores";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("score entry checks", () => {
  it("accepts real SAT scores and rejects impossible ones", () => {
    expect(ScoreInputSchema.safeParse({ source: "PSAT", takenOn: "2026-10-10", total: 980, rw: 500, math: 480 }).success).toBe(true);
    expect(ScoreInputSchema.safeParse({ source: "SAT", takenOn: "2026-10-10", total: 985 }).success).toBe(false); // steps of 10
    expect(ScoreInputSchema.safeParse({ source: "SAT", takenOn: "2026-10-10", total: 1700 }).success).toBe(false);
    expect(ScoreInputSchema.safeParse({ source: "SAT", takenOn: "2026-10-10", total: 1000, rw: 500, math: 480 }).success).toBe(false); // doesn't add up
    expect(ScoreInputSchema.safeParse({ source: "MOCK", takenOn: "2026-10-10", total: 1000 }).success).toBe(false);
  });

  it("refuses any field for question content", () => {
    expect(ScoreInputSchema.safeParse({ source: "PRACTICE_BLUEBOOK", takenOn: "2026-10-10", total: 1000, questions: ["What is x?"] }).success).toBe(false);
    expect(MissedSchema.safeParse({ section: "MATH", module: 1, number: 7, domain: "algebra" }).success).toBe(true);
    expect(MissedSchema.safeParse({ section: "MATH", module: 1, number: 7, domain: "algebra", questionText: "Solve 2x = 4" }).success).toBe(false);
    expect(MissedSchema.safeParse({ section: "MATH", module: 1, number: 7, domain: "info-ideas" }).success).toBe(false); // R&W domain in Math
    expect(MissedSchema.safeParse({ section: "RW", module: 3, number: 7, domain: "info-ideas" }).success).toBe(false);
  });
});

describe("projection", () => {
  it("follows the recent trend for the weeks since the last score, as a range", () => {
    const pts = [
      { takenOn: d("2026-09-01"), total: 1000, source: "PSAT" },
      { takenOn: d("2026-09-29"), total: 1040, source: "DIAGNOSTIC" },
      { takenOn: d("2026-10-27"), total: 1080, source: "PRACTICE_BLUEBOOK" },
    ];
    // +10 a week; two weeks after the last score.
    expect(projectScore(pts, null, d("2026-11-10"))).toMatchObject({ mid: 1100, low: 1060, high: 1140 });
    // Strong practice since adds 10; weak takes 10; too few answers do nothing.
    expect(projectScore(pts, { answered: 30, accuracy: 0.8 }, d("2026-11-10"))!.mid).toBe(1110);
    expect(projectScore(pts, { answered: 30, accuracy: 0.4 }, d("2026-11-10"))!.mid).toBe(1090);
    expect(projectScore(pts, { answered: 5, accuracy: 0.4 }, d("2026-11-10"))!.mid).toBe(1100);
  });

  it("caps the trend, stays on the scale, and widens with few scores", () => {
    const one = [{ takenOn: d("2026-10-01"), total: 1580, source: "SAT" }];
    expect(projectScore(one, null, d("2026-11-10"))).toMatchObject({ mid: 1580, low: 1520, high: 1600 });
    const steep = [
      { takenOn: d("2026-10-01"), total: 900, source: "SAT" },
      { takenOn: d("2026-10-08"), total: 1100, source: "SAT" },
    ];
    expect(projectScore(steep, null, d("2026-12-31"))!.mid).toBe(1160); // +60 cap
    expect(projectScore([], null)).toBeNull();
  });

  it("flags stalling: no gain over 3 scores, or a 30-point drop within 3 weeks", () => {
    expect(stalling([{ takenOn: d("2026-10-01"), total: 1000, source: "SAT" }]).stalled).toBe(false);
    expect(stalling([1000, 1020, 1000].map((t, i) => ({ takenOn: d(`2026-10-0${i + 1}`), total: t, source: "SAT" })))).toEqual({ stalled: true, reason: "No gain over the last 3 scores" });
    expect(stalling([1000, 1060, 1020].map((t, i) => ({ takenOn: d(`2026-10-1${i}`), total: t, source: "SAT" })))).toEqual({ stalled: true, reason: "Dropped 40 points in 3 weeks" });
    expect(stalling([1000, 1060, 1020].map((t, i) => ({ takenOn: d(`2026-0${i + 6}-10`), total: t, source: "SAT" })))).toEqual({ stalled: false, reason: null }); // the drop was over 3 weeks; still a gain overall
    expect(stalling([1000, 1040, 1080].map((t, i) => ({ takenOn: d(`2026-10-1${i}`), total: t, source: "SAT" }))).stalled).toBe(false);
  });
});

describe("program statistics", () => {
  it("averages gains, counts who's on track, and measures distance to the targets", () => {
    const s = programStats(
      [
        { id: "a", baseline: 970, latest: 1150, projected: 1280, target: 1200 }, // on track: +310 projected
        { id: "b", baseline: 1000, latest: 1210, projected: 1220, target: 1200 }, // on track: past target
        { id: "c", baseline: 950, latest: 1000, projected: 1010, target: 1300 },
        { id: "d", baseline: null, latest: null, projected: null, target: 1200 },
      ],
      [1200, 1300],
    );
    expect(s).toMatchObject({ students: 4, withBaseline: 3, missingBaseline: 1, averageBaseline: 973, averageLatest: 1120, averageGain: 147, medianGain: 180, onTrack: 2 });
    expect(s.byTarget).toEqual([
      { target: 1200, reached: 1, averageGap: Math.round((50 + 0 + 200) / 3) },
      { target: 1300, reached: 0, averageGap: Math.round((150 + 90 + 300) / 3) },
    ]);
    expect(s.distribution.find((b) => b.from === 1100)!.count).toBe(1);
    expect(s.distribution.find((b) => b.from === 1200)!.count).toBe(1);
  });
});
