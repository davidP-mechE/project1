import { describe, expect, it } from "vitest";
import { allowedDomains, cleanTags, scopeCovers, scopeLabel, workDomains } from "@/lib/sat/domains";
import { normalizeWorksheet } from "@/lib/ai/worksheet";
import { sampleWorksheet } from "../helpers/fake-claude";

describe("SAT domains", () => {
  it("cleans tags: unknown values are dropped and the section follows the domain", () => {
    expect(cleanTags({ domain: "algebra", skill: "linear functions", difficulty: "HARD", section: "RW" })).toEqual({ section: "MATH", domain: "algebra", skill: "Linear functions", difficulty: "HARD" });
    expect(cleanTags({ domain: "history", skill: "x", difficulty: "brutal" })).toEqual({ section: null, domain: null, skill: null, difficulty: null });
    expect(cleanTags({ domain: "conventions", skill: "Not a real skill" }).skill).toBeNull();
  });

  it("works out what a scope covers", () => {
    expect(allowedDomains({ sections: [], domains: [] })).toBeNull();
    const math = allowedDomains({ sections: ["MATH"], domains: [] });
    expect([...math!].sort()).toEqual(["advanced-math", "algebra", "geo-trig", "psda"]);
    expect(scopeCovers(math, { section: "MATH", domains: [] })).toBe(true);
    expect(scopeCovers(math, { section: null, domains: ["algebra"] })).toBe(true);
    expect(scopeCovers(math, { section: "RW", domains: [] })).toBe(false);
    expect(scopeCovers(math, { section: null, domains: ["algebra", "info-ideas"] })).toBe(false); // mixed work needs both
    expect(scopeCovers(math, { section: null, domains: [] })).toBe(false); // untagged work only without a subject limit
    expect(scopeCovers(null, { section: null, domains: [] })).toBe(true);
    const adv = allowedDomains({ sections: [], domains: ["advanced-math"] });
    expect(scopeCovers(adv, { section: "MATH", domains: [] })).toBe(false); // a whole section is more than one domain
    expect(workDomains({ section: "RW", domains: [] })).toHaveLength(4);
    expect(scopeLabel({ sections: ["MATH"], domains: ["conventions"] })).toBe("Math, Standard English Conventions");
  });

  it("keeps Claude's suggested tags on worksheet questions, unconfirmed", () => {
    const items = normalizeWorksheet(sampleWorksheet(), 2);
    expect(items[0]).toMatchObject({ section: "MATH", domain: "algebra", skill: "Linear equations in one variable", difficulty: "EASY", tagsConfirmed: false });
    expect(items[1]).toMatchObject({ section: "RW", domain: "craft-structure", desmosSolvable: false }); // Desmos only for Math
    expect(items[2]).toMatchObject({ section: null, domain: null, difficulty: "HARD" });
  });
});
