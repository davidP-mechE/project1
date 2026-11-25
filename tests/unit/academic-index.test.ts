import { describe, expect, it } from "vitest";
import { ACT_TO_SAT, BANNED_WORDS, DISCLAIMER, ESTIMATE_LABELS, TIERS, actToSat } from "@/lib/academic-index/config";
import { applyEssayRules, closestRun, combineEssays, countWords, essayTotal, medianCriteria } from "@/lib/academic-index/essays";
import { emptyInputs, type AcademicInputs, type CriteriaScores } from "@/lib/academic-index/inputs";
import { AcademicIndexInputError, biggestLever, computeAcademicIndex, convertedGpa, gradeValue, leverOptions, roundHalfUp, superscore, tierFor, validateInputs, type ScoringInput } from "@/lib/academic-index/score";

const crit = (voice: number, insight: number, detail: number, structure: number, clarity: number): CriteriaScores => ({ voice, insight, detail, structure, clarity });
/** An essay scoring `total` points (spread over the criteria). */
const essay = (total: number): CriteriaScores => {
  const base = Math.floor(total / 5);
  const extra = total - base * 5;
  const v = [0, 1, 2, 3, 4].map((i) => base + (i < extra ? 1 : 0));
  return crit(v[0], v[1], v[2], v[3], v[4]);
};

function input(over: (i: AcademicInputs) => void, essayScores: ScoringInput["essayScores"] = { personalStatement: null, supplements: [] }): ScoringInput {
  const i = emptyInputs();
  over(i);
  return { ...i, essayScores };
}

/** Student A from the spec (section 7). */
const studentA = (testOptional = false) =>
  input(
    (i) => {
      i.testing = testOptional ? { type: "NONE", satSittings: [], actComposite: null } : { type: "SAT", satSittings: [{ date: "2026-03", erw: 720, math: 730 }], actComposite: null };
      i.grades.unweightedGpa = 3.85;
      i.rigor = { offeredAdvanced: 12, offeredHonors: 0, takenAdvanced: 8, takenHonors: 0, selfRating: null, exams: [{ name: "AP Biology", kind: "AP", score: 5 }, { name: "AP World History", kind: "AP", score: 5 }] };
      i.activities = [
        { kind: "HONOR", name: "State science award", type: "", level: "STATE", leadership: false },
        { kind: "ACTIVITY", name: "Robotics club", type: "Robotics", level: "REGIONAL", leadership: true },
        { kind: "ACTIVITY", name: "Chess club", type: "Club", level: "SCHOOL", leadership: false },
      ];
      i.essays.personalStatement = "An essay.";
    },
    { personalStatement: crit(4, 4, 3, 4, 5), supplements: [] },
  );

describe("Academic Index: worked examples (spec section 7)", () => {
  it("Student A, full application: 189 Excellent", () => {
    const r = computeAcademicIndex(studentA());
    expect(r.components.test.earned).toBeCloseTo(63.44, 2);
    expect(r.components.gpa.earned).toBeCloseTo(67.38, 2);
    expect(r.components.rigor.earned).toBeCloseTo(22, 6);
    expect(r.components.activities.earned).toBe(16);
    expect(r.components.essays.earned).toBe(20);
    expect(r.exactTotal).toBeCloseTo(188.81, 2);
    expect(r.total).toBe(189);
    expect(r.tier).toBe("Excellent");
    expect(r.estimateType).toBe("full");
    expect(r.labels).toEqual([]);
    expect(r.formulaVersion).toBe("v1");
  });

  it("Student A, test-optional: 180 Strong (test-optional estimate)", () => {
    const r = computeAcademicIndex(studentA(true));
    expect(r.components.test.present).toBe(false);
    expect(r.exactTotal).toBeCloseTo(180.23, 2);
    expect(r.total).toBe(180);
    expect(r.tier).toBe("Strong");
    expect(r.estimateType).toBe("test_optional");
    expect(r.labels).toEqual([ESTIMATE_LABELS.test_optional]);
  });

  it("Student B, ACT with supplements: 169 Strong", () => {
    const r = computeAcademicIndex(
      input(
        (i) => {
          i.testing = { type: "ACT", satSittings: [], actComposite: 27 };
          i.grades.unweightedGpa = 3.4;
          i.rigor.selfRating = "MOST"; // no advanced courses offered
          i.rigor.offeredAdvanced = 0;
          i.activities = [
            { kind: "ACTIVITY", name: "Band", type: "", level: "SCHOOL", leadership: false },
            { kind: "ACTIVITY", name: "Newspaper", type: "", level: "SCHOOL", leadership: true },
            { kind: "ACTIVITY", name: "Volunteering", type: "", level: "PARTICIPATION", leadership: false },
          ];
        },
        { personalStatement: essay(16), supplements: [essay(12), essay(14)] },
      ),
    );
    expect(r.detail.satUsed).toBe(1280);
    expect(r.components.test.earned).toBe(56);
    expect(r.components.gpa.earned).toBeCloseTo(59.5, 6);
    expect(r.components.rigor.earned).toBe(30);
    expect(r.components.activities.earned).toBe(8);
    expect(r.components.essays.earned).toBeCloseTo(15.1, 6);
    expect(r.exactTotal).toBeCloseTo(168.6, 6);
    expect(r.total).toBe(169);
    expect(r.tier).toBe("Strong");
  });
});

describe("Academic Index: edge cases (spec section 7)", () => {
  it("a perfect application is 230", () => {
    const r = computeAcademicIndex(
      input(
        (i) => {
          i.testing = { type: "SAT", satSittings: [{ date: "", erw: 800, math: 800 }], actComposite: null };
          i.grades.unweightedGpa = 4;
          i.rigor = { offeredAdvanced: 10, offeredHonors: 0, takenAdvanced: 10, takenHonors: 0, selfRating: null, exams: Array.from({ length: 6 }, (_, n) => ({ name: `AP ${n}`, kind: "AP" as const, score: 5 })) };
          i.activities = [0, 1, 2].map((n) => ({ kind: "HONOR" as const, name: `National award ${n}`, type: "", level: "NATIONAL", leadership: false }));
        },
        { personalStatement: crit(5, 5, 5, 5, 5), supplements: [] },
      ),
    );
    expect(r.components.rigor.earned).toBe(35);
    expect(r.total).toBe(230);
    expect(r.tier).toBe("Distinguished");
  });

  it("SAT 400 and everything else zero: 17.5 rounds up to 18", () => {
    const r = computeAcademicIndex(
      input(
        (i) => {
          i.testing = { type: "SAT", satSittings: [{ date: "", erw: 200, math: 200 }], actComposite: null };
          i.grades.unweightedGpa = 0;
          i.rigor = { offeredAdvanced: 5, offeredHonors: 0, takenAdvanced: 0, takenHonors: 0, selfRating: null, exams: [] };
        },
        { personalStatement: crit(0, 0, 0, 0, 0), supplements: [] },
      ),
    );
    expect(r.exactTotal).toBe(17.5);
    expect(r.total).toBe(18);
    expect(r.tier).toBe("Foundational");
  });

  it("rejects a GPA above 4.0", () => {
    const i = input((x) => {
      x.testing.type = "NONE";
      x.grades.unweightedGpa = 4.3;
      x.rigor.selfRating = "AVERAGE";
    });
    expect(validateInputs(i)).toContainEqual({ path: "grades.unweightedGpa", message: "Enter your unweighted GPA (0.00–4.00)" });
    expect(() => computeAcademicIndex(i)).toThrow(AcademicIndexInputError);
  });

  it("caps the rigor ratio at 1 when more are taken than offered", () => {
    const r = computeAcademicIndex(
      input((i) => {
        i.testing.type = "NONE";
        i.grades.unweightedGpa = 3;
        i.rigor = { offeredAdvanced: 4, offeredHonors: 0, takenAdvanced: 9, takenHonors: 2, selfRating: null, exams: [] };
      }),
    );
    expect(r.detail.rigorBase).toBe(30);
  });

  it("counts only the top 3 of 15 activity items", () => {
    const r = computeAcademicIndex(
      input((i) => {
        i.testing.type = "NONE";
        i.grades.unweightedGpa = 3;
        i.rigor.selfRating = "AVERAGE";
        i.activities = [
          ...Array.from({ length: 10 }, (_, n) => ({ kind: "ACTIVITY" as const, name: `Club ${n}`, type: "", level: n === 4 ? "STATE" : "SCHOOL", leadership: n === 7 })),
          ...Array.from({ length: 5 }, (_, n) => ({ kind: "HONOR" as const, name: `Honor ${n}`, type: "", level: n === 2 ? "NATIONAL" : "SCHOOL", leadership: false })),
        ];
      }),
    );
    expect(r.detail.activityPoints).toEqual([10, 7, 4]);
    expect(r.components.activities.earned).toBe(21);
  });

  it("caps leadership at 10 points per item", () => {
    const r = computeAcademicIndex(
      input((i) => {
        i.testing.type = "NONE";
        i.grades.unweightedGpa = 3;
        i.rigor.selfRating = "AVERAGE";
        i.activities = [{ kind: "ACTIVITY", name: "Founder of national org", type: "", level: "NATIONAL", leadership: true }];
      }),
    );
    expect(r.components.activities.earned).toBe(10);
  });

  it("a 700-word personal statement: warning and −1 on Clarity & mechanics", () => {
    const text = Array.from({ length: 700 }, () => "word").join(" ");
    const r = applyEssayRules(crit(4, 4, 4, 4, 4), { kind: "personal_statement", text, wordLimit: null, answersPrompt: true });
    expect(r.wordCount).toBe(700);
    expect(r.criteria.clarity).toBe(3);
    expect(r.warnings[0]).toMatch(/650-word limit/);
    const ok = applyEssayRules(crit(4, 4, 4, 4, 4), { kind: "personal_statement", text: "Short.", wordLimit: null, answersPrompt: true });
    expect(ok.criteria.clarity).toBe(4);
    expect(ok.warnings).toEqual([]);
  });

  it("a supplement over its own limit, and one that misses its prompt", () => {
    const over = applyEssayRules(crit(4, 4, 4, 4, 0), { kind: "supplement", text: "one two three", wordLimit: 2, answersPrompt: true });
    expect(over.criteria.clarity).toBe(0); // never below 0
    const off = applyEssayRules(crit(5, 5, 5, 5, 5), { kind: "supplement", text: "x", wordLimit: 250, answersPrompt: false, promptNote: "It describes a club but not why this college." });
    expect(off.criteria.insight).toBe(2);
    expect(off.warnings[0]).toMatch(/capped at 2.*why this college/);
  });
});

describe("Academic Index: pieces", () => {
  it("superscores the best ERW and best Math across dates", () => {
    expect(superscore([{ date: "", erw: 650, math: 700 }, { date: "", erw: 700, math: 640 }])).toBe(1400);
    expect(superscore([{ date: "", erw: 650, math: null }])).toBeNull();
  });

  it("uses whichever of SAT or ACT gives more points, never mixing", () => {
    const both = (sat: [number, number], act: number) =>
      computeAcademicIndex(
        input((i) => {
          i.testing = { type: "BOTH", satSittings: [{ date: "", erw: sat[0], math: sat[1] }], actComposite: act };
          i.grades.unweightedGpa = 3;
          i.rigor.selfRating = "AVERAGE";
        }),
      ).detail;
    expect(both([700, 700], 30)).toMatchObject({ satUsed: 1400, testSource: "SAT" });
    expect(both([600, 600], 33)).toMatchObject({ satUsed: 1460, testSource: "ACT" });
  });

  it("ACT table matches the spec and maps 1–8 to 400", () => {
    expect(Object.keys(ACT_TO_SAT)).toHaveLength(28);
    expect(actToSat(33)).toBe(1460);
    expect(actToSat(36)).toBe(1590);
    expect(actToSat(9)).toBe(590);
    expect(actToSat(8)).toBe(400);
    expect(actToSat(1)).toBe(400);
    // ACT 33 → 1460 → 63.9 (spec 5.1)
    const r = computeAcademicIndex(input((i) => { i.testing = { type: "ACT", satSittings: [], actComposite: 33 }; i.grades.unweightedGpa = 3; i.rigor.selfRating = "AVERAGE"; }));
    expect(r.components.test.earned).toBeCloseTo(63.875, 6);
  });

  it("converts 100-point and letter grades", () => {
    expect(gradeValue("93")).toBe(4);
    expect(gradeValue("92")).toBe(3.7);
    expect(gradeValue("64")).toBe(0);
    expect(gradeValue("B+")).toBe(3.3);
    expect(gradeValue("a-")).toBe(3.7);
    expect(gradeValue("Q")).toBeNull();
    expect(convertedGpa([{ grade: "95" }, { grade: "85" }, { grade: "" }])).toBeCloseTo(3.5, 6);
  });

  it("tiers cover every whole score once", () => {
    for (let s = 0; s <= 230; s++) expect(tierFor(s)).toBeTruthy();
    expect(tierFor(99).name).toBe("Foundational");
    expect(tierFor(100).name).toBe("Developing");
    expect(tierFor(164).name).toBe("Competitive");
    expect(tierFor(165).name).toBe("Strong");
    expect(tierFor(220).name).toBe("Distinguished");
  });

  it("rounds halves up only at the total", () => {
    expect(roundHalfUp(188.5)).toBe(189);
    expect(roundHalfUp(188.49)).toBe(188);
    expect(roundHalfUp(17.499999999999)).toBe(18);
  });

  it("partial estimate when essays aren't scored yet, scaled to 230", () => {
    const i = studentA();
    i.essayScores.personalStatement = null;
    const r = computeAcademicIndex(i);
    expect(r.estimateType).toBe("partial");
    expect(r.labels).toEqual([ESTIMATE_LABELS.partial]);
    expect(r.total).toBe(roundHalfUp(((63.4375 + 67.375 + 22 + 16) / 205) * 230));
  });

  it("combines essays 0.7 / 0.3 and takes per-criterion medians", () => {
    expect(combineEssays(20, [])).toBe(20);
    expect(combineEssays(16, [12, 14])).toBeCloseTo(15.1, 6);
    const runs = [crit(3, 4, 2, 5, 4), crit(4, 4, 3, 1, 4), crit(5, 2, 3, 4, 3)];
    const m = medianCriteria(runs);
    expect(m).toEqual(crit(4, 4, 3, 4, 4));
    expect(essayTotal(m)).toBe(19);
    expect(closestRun(runs.map((criteria, n) => ({ criteria, n })), m).n).toBe(0);
    expect(countWords("  Two   words\n")).toBe(2);
  });

  it("lists what's needed, including activity levels the Common App doesn't record", () => {
    const i = emptyInputs();
    i.activities = [{ kind: "ACTIVITY", name: "Debate", type: "", level: null, leadership: false }];
    const paths = validateInputs(i).map((x) => x.path);
    expect(paths).toEqual(["testing.type", "grades.unweightedGpa", "rigor", "activities.0.level"]);
  });
});

describe("Academic Index: biggest lever (spec section 8)", () => {
  it("Student A: +100 SAT is +4.4; the biggest step is picked", () => {
    const options = leverOptions(studentA());
    const test = options.find((o) => o.component === "test")!;
    expect(test.gain).toBeCloseTo(4.375, 6);
    const gpa = options.find((o) => o.component === "gpa")!;
    expect(gpa.gain).toBeCloseTo(1.75, 6);
    const rigor = options.find((o) => o.component === "rigor")!;
    expect(rigor.gain).toBeCloseTo(5, 6); // 10/12 → 25 vs 20
    const acts = options.find((o) => o.component === "activities")!;
    expect(acts.gain).toBe(2); // school club (3) → regional (5)
    const essays = options.find((o) => o.component === "essays")!;
    expect(essays.gain).toBe(1);
    expect(biggestLever(studentA())!.component).toBe("rigor");
  });

  it("skips the GPA step for seniors and the test step when test-optional", () => {
    const i = studentA(true);
    i.grades.senior = true;
    const comps = leverOptions(i).map((o) => o.component);
    expect(comps).not.toContain("gpa");
    expect(comps).not.toContain("test");
  });
});

describe("Academic Index: wording (spec section 9)", () => {
  it("never mentions chances, odds or likely to get in", () => {
    const texts = [DISCLAIMER, ...TIERS.map((t) => t.message), ...Object.values(ESTIMATE_LABELS)];
    for (const t of texts) for (const w of BANNED_WORDS) expect(t).not.toMatch(w);
  });
});
