import { describe, expect, it } from "vitest";
import { flagsFor, summarize } from "@/lib/bank/stats";

describe("question stats", () => {
  it("totals answers, percent correct, average time and each answer's count", () => {
    const s = summarize([
      { answerGiven: "B", correct: true, n: 6, seconds: 300 },
      { answerGiven: "C", correct: false, n: 3, seconds: 240 },
      { answerGiven: "A", correct: false, n: 1, seconds: 60 },
    ]);
    expect(s).toMatchObject({ attempts: 10, correct: 6, pct: 0.6, avgSeconds: 60 });
    expect(s.answers.map((a) => [a.answer, a.n])).toEqual([["B", 6], ["C", 3], ["A", 1]]);
    expect(summarize([])).toMatchObject({ attempts: 0, pct: null, avgSeconds: null });
  });

  it("flags questions answered correctly far less often than their difficulty suggests (with 10+ answers)", () => {
    const low = summarize([{ answerGiven: "B", correct: true, n: 3, seconds: 0 }, { answerGiven: "C", correct: false, n: 2, seconds: 0 }, { answerGiven: "A", correct: false, n: 2, seconds: 0 }, { answerGiven: "D", correct: false, n: 3, seconds: 0 }]);
    expect(flagsFor({ difficulty: 1, type: "mcq" }, low, 0).map((f) => f.code)).toEqual(["TOO_HARD"]); // 30% on an easy one
    expect(flagsFor({ difficulty: 3, type: "mcq" }, low, 0)).toEqual([]); // fine for a hard one
    const few = summarize([{ answerGiven: "C", correct: false, n: 4, seconds: 0 }]);
    expect(flagsFor({ difficulty: 1, type: "mcq" }, few, 0)).toEqual([]); // too few answers to judge
  });

  it("flags a wrong choice picked more than the right one, and many reports", () => {
    const s = summarize([{ answerGiven: "B", correct: true, n: 4, seconds: 0 }, { answerGiven: "C", correct: false, n: 6, seconds: 0 }]);
    const f = flagsFor({ difficulty: 3, type: "mcq" }, s, 3);
    expect(f.map((x) => x.code)).toEqual(["WRONG_CHOICE_WINS", "REPORTED"]);
    expect(f[0].text).toContain("More students picked C (6) than the right answer (4)");
    expect(flagsFor({ difficulty: 3, type: "grid_in" }, s, 0)).toEqual([]); // grid-ins have no choices to compare
  });
});
