import { describe, expect, it } from "vitest";
import { domainFrom, missedFrom, parseQuestionReview, rankDomains, readScoreReports, skillFrom, validBands } from "@/lib/sat/cb-import";

describe("College Board names", () => {
  it("maps domain and skill labels to ours", () => {
    expect(domainFrom("Problem-Solving and Data Analysis")).toBe("psda");
    expect(domainFrom("Standard English Conventions")).toBe("conventions");
    expect(domainFrom("Math: Advanced Math")).toBe("advanced-math");
    expect(domainFrom("Craft & Structure")).toBe("craft-structure");
    expect(domainFrom("Poetry")).toBeNull();
    expect(skillFrom("craft-structure", "Words in Context")).toBe("Words in context");
    expect(skillFrom("algebra", "Made up")).toBeNull();
  });
});

describe("a pasted question review", () => {
  it("reads a copied table (tabs), ignores content columns, and finds the misses", () => {
    const text = [
      "Question\tSection\tModule\tContent Domain\tSkill\tCorrect Answer\tYour Answer\tQuestion Text",
      "1\tReading and Writing\t1\tCraft and Structure\tWords in Context\tB\tB\tThe passage says…",
      "2\tReading and Writing\t1\tStandard English Conventions\tBoundaries\tC\tA\tChoose the…",
      "3\tMath\t2\tAlgebra\tLinear functions\t12\t12\tA line…",
      "4\tMath\t2\tGeometry and Trigonometry\tCircles\tD\t\tA circle…",
    ].join("\n");
    const r = parseQuestionReview(text);
    expect(r.questions).toHaveLength(4);
    expect(r.questions.map((q) => q.correct)).toEqual([true, false, true, false]);
    expect(r.ignoredColumns).toEqual(["Question Text"]);
    expect(JSON.stringify(r.questions)).not.toMatch(/passage|circle…|Choose/);
    expect(missedFrom(r.questions)).toEqual([
      { section: "RW", module: 1, number: 2, domain: "conventions", skill: "Boundaries" },
      { section: "MATH", module: 2, number: 4, domain: "geo-trig", skill: "Circles" },
    ]);
  });

  it("reads CSV with a result column and module heading rows, and reports what it skipped", () => {
    const text = ["number,domain,skill,result", "Math Module 1", "1,Algebra,,Correct", "2,Advanced Math,Nonlinear functions,Incorrect", "Math Module 2", "1,Advanced Math,,Omitted", "2,Poetry,,Correct", "3,Algebra,,maybe"].join("\n");
    const r = parseQuestionReview(text);
    expect(r.questions.map((q) => `${q.section}${q.module}-${q.number}:${q.correct}`)).toEqual(["MATH1-1:true", "MATH1-2:false", "MATH2-1:false"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['Unknown domain "Poetry"', "Can't tell if it was right or wrong"]);
  });

  it("reads rows without a header in the documented order", () => {
    const r = parseQuestionReview("RW,1,5,Expression of Ideas,Transitions,wrong");
    expect(r.questions).toEqual([{ section: "RW", module: 1, number: 5, domain: "expression", skill: "Transitions", correct: false }]);
  });
});

describe("a class spreadsheet of score reports", () => {
  it("matches columns by name and checks each row", () => {
    const csv = [
      "Student Email,Assessment,Test Date,Total Score,Evidence-Based Reading and Writing,Math,Algebra,Craft and Structure,Teacher",
      "ana@example.com,PSAT/NMSQT,10/15/2026,1010,520,490,3,5,Ms. Lee",
      "ben@example.com,Bluebook Practice Test 4,2026-11-01,1200,600,600,6,8,Ms. Lee",
      "nobody,SAT,,1700,,,,,",
    ].join("\n");
    const { rows, error, ignoredColumns } = readScoreReports(csv);
    expect(error).toBeNull();
    expect(ignoredColumns).toEqual(["Teacher"]);
    expect(rows[0]).toMatchObject({ email: "ana@example.com", source: "PSAT", takenOn: "2026-10-15", total: 1010, rw: 520, math: 490, bands: { algebra: 3, "craft-structure": 5 }, errors: [] });
    expect(rows[1].source).toBe("PRACTICE_BLUEBOOK");
    expect(rows[1].errors).toEqual(["Craft and Structure: use 1 to 7"]);
    expect(rows[2].errors).toEqual(expect.arrayContaining(["No valid email", "No test date", "Total must be 400–1600 in steps of 10"]));
  });

  it("needs an email and a total column", () => {
    expect(readScoreReports("Name,Total\nAna,1000").error).toMatch(/Email/);
    expect(readScoreReports("Email,Score\na@b.co,1000").error).toMatch(/Total/);
  });
});

describe("pinpointing weaknesses", () => {
  it("ranks domains weakest first from bands, College Board reviews and site accuracy", () => {
    const e = (domain: string, x: Partial<Parameters<typeof rankDomains>[0][number]>) => ({ domain, band: null, cbRight: 0, cbTotal: 0, siteAccuracy: null, siteAnswers: 0, openMistakes: 0, ...x });
    const r = rankDomains([e("algebra", { band: 6, cbRight: 9, cbTotal: 10 }), e("geo-trig", { band: 2, cbRight: 1, cbTotal: 5 }), e("psda", { siteAccuracy: 0.5, siteAnswers: 20 }), e("advanced-math", {})]);
    expect(r.map((x) => x.domain)).toEqual(["geo-trig", "psda", "algebra", "advanced-math"]);
    expect(r.at(-1)!.strength).toBeNull();
    expect(validBands({ algebra: 3, "Craft and Structure": "5", psda: 9, nope: 2 })).toEqual({ algebra: 3, "craft-structure": 5 });
  });
});
